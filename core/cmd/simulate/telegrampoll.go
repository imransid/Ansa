package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"ansa/core/internal/commands"
	"ansa/core/internal/config"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/telegram"
)

// telegram-poll reads a REAL development bot's updates from Telegram with
// getUpdates (the old `pnpm telegram:poll`) and hands each to core's
// Telegram webhook handler IN THIS PROCESS, exactly as the webhook would
// receive it (the same secret check, limits and saving), so a real
// Telegram account can be tried on this laptop without a public address.
// A running core answers the messages. Telegram refuses polling while the
// bot has a webhook: use a bot of its own for development (`make
// telegram-webhook ACTION=remove` takes a webhook off). Ctrl+C stops it.
var telegramPollTool = tool{
	usage: "telegram-poll",
	does:  "saves a real bot's messages into a development database",
	fits:  exactly(0),
	run:   runTelegramPoll,
}

// After a failed read or save, wait this long before asking again.
const pollRetryAfter = 5 * time.Second

func runTelegramPoll(ctx context.Context, w *world, _ []string) error {
	if !telegramIsSetUp(w.cfg) {
		return commands.Refusal("Set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET in .env.core first (a development bot of its own: docs/going-live.md, section 12).")
	}
	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()
	poller := newTelegramPoller(w, pollRetryAfter)
	fmt.Fprintf(w.out, "Reading @%s's messages; a running core answers them. Press Ctrl+C to stop.\n", w.cfg.TelegramBotUsername)
	for ctx.Err() == nil {
		if err := poller.once(ctx); err != nil {
			return err
		}
	}
	fmt.Fprintln(w.out, "Stopped.")
	return nil
}

func telegramIsSetUp(cfg config.Config) bool {
	return cfg.TelegramBotToken != "" && cfg.TelegramBotUsername != "" && cfg.TelegramWebhookSecret != ""
}

// telegramPoller reads batches of updates and remembers where it is.
type telegramPoller struct {
	hook       *telegram.Webhook
	token      string
	secret     string
	offset     int64
	retryAfter time.Duration
	out        io.Writer
}

func newTelegramPoller(w *world, retryAfter time.Duration) *telegramPoller {
	hook := &telegram.Webhook{Pool: w.pool, Limiter: ratelimit.New(w.pool, w.cfg.AuthSecret), Box: w.box, Log: logging.New(os.Stderr),
		Secret: w.cfg.TelegramWebhookSecret, BotToken: w.cfg.TelegramBotToken}
	return &telegramPoller{hook: hook, token: w.cfg.TelegramBotToken, secret: w.cfg.TelegramWebhookSecret, retryAfter: retryAfter, out: w.out}
}

// once reads one batch and hands each update to core's webhook code. An
// update that wasn't saved (core answered 500 or 429, as Telegram would
// be) is read again after a wait. It returns an error only to stop.
func (p *telegramPoller) once(ctx context.Context) error {
	result := telegram.GetUpdates(ctx, p.token, p.offset)
	if result.WebhookSet {
		return commands.Refusal("This bot has a webhook, so Telegram sends its messages there. Remove it with: make telegram-webhook ACTION=remove")
	}
	if !result.OK {
		if ctx.Err() == nil {
			fmt.Fprintf(p.out, "Telegram didn't answer (%s). Trying again in a moment.\n", describeStatus(result.Status))
			wait(ctx, p.retryAfter)
		}
		return nil
	}
	for _, raw := range result.Updates {
		status := serveInProcess(p.hook, "/webhooks/telegram", raw, telegramSecretHeader(p.secret))
		if status == http.StatusInternalServerError || status == http.StatusTooManyRequests {
			fmt.Fprintf(p.out, "An update wasn't saved (HTTP %d). Trying it again in a moment.\n", status)
			wait(ctx, p.retryAfter)
			return nil
		}
		if id, ok := updateID(raw); ok && id >= p.offset {
			p.offset = id + 1
		}
		fmt.Fprintf(p.out, "Handled an update (%s).\n", describeUpdate(raw))
	}
	return nil
}

// updateID is the update's number (the next read starts after it).
func updateID(raw json.RawMessage) (int64, bool) {
	var read struct {
		UpdateID *int64 `json:"update_id"`
	}
	if json.Unmarshal(raw, &read) != nil || read.UpdateID == nil {
		return 0, false
	}
	return *read.UpdateID, true
}

// describeUpdate is what kind of update it was, never what it held.
func describeUpdate(raw json.RawMessage) string {
	update, err := telegram.ParseUpdate(raw)
	switch {
	case err != nil:
		return "not one ansa reads"
	case update.Message != nil:
		return "a message to the bot"
	case update.BusinessConnection != nil:
		return "a business connection"
	case update.BusinessMessage != nil:
		return "a chat message"
	case update.DeletedMessages != nil:
		return "deleted messages"
	}
	return "ignored"
}

func describeStatus(status int) string {
	if status == 0 {
		return "no answer"
	}
	return "HTTP " + strconv.Itoa(status)
}

// wait sleeps, or less when the command is stopped.
func wait(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}
