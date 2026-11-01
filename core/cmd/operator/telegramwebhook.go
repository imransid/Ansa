package main

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"ansa/core/internal/commands"
	"ansa/core/internal/telegram"
)

// telegram-webhook tells Telegram to send ansa's bot's updates to core's
// webhook, POST <core's public https address>/webhooks/telegram, with
// TELEGRAM_WEBHOOK_SECRET (Telegram sends it back with every update), and
// asks for the four kinds of updates ansa reads; or takes the webhook off
// (a development bot read by `make telegram-poll`). The old `pnpm
// telegram:webhook`. Changes nothing in the database. Prints only the
// outcome: never the token or Telegram's own words.
var telegramWebhookCommand = command{
	usage: "telegram-webhook set <core's public https address> | telegram-webhook remove",
	fits: func(args []string) bool {
		return (len(args) == 2 && args[0] == "set" && strings.TrimSpace(args[1]) != "") || (len(args) == 1 && args[0] == "remove")
	},
	run: runTelegramWebhook,
}

const telegramWebhookPath = "/webhooks/telegram"

func runTelegramWebhook(ctx context.Context, w *world, args []string) error {
	cfg := w.cfg
	if cfg.TelegramBotToken == "" || cfg.TelegramBotUsername == "" || cfg.TelegramWebhookSecret == "" {
		return commands.Refusal("Set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET first (docs/going-live.md, section 12).")
	}
	if args[0] == "remove" {
		if err := telegramRefusal(telegram.DeleteWebhook(ctx, cfg.TelegramBotToken)); err != nil {
			return err
		}
		fmt.Fprintln(w.out, "Webhook removed: the bot's updates now wait for make telegram-poll.")
		return nil
	}
	address, err := webhookAddress(args[1])
	if err != nil {
		return err
	}
	if err := telegramRefusal(telegram.SetWebhook(ctx, cfg.TelegramBotToken, address, cfg.TelegramWebhookSecret)); err != nil {
		return err
	}
	fmt.Fprintf(w.out, "Webhook set: Telegram now sends @%s's updates to %s.\n", cfg.TelegramBotUsername, address)
	return nil
}

// webhookAddress is core's public address with the webhook's path. Telegram
// sends webhooks to https addresses only.
func webhookAddress(given string) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(given), "/")
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
		return "", commands.Refusal("Telegram sends webhooks to https addresses only: give core's public address, like https://core.yourdomain.com.")
	}
	return base + telegramWebhookPath, nil
}

// telegramRefusal reads Telegram's answer by its status only.
func telegramRefusal(result telegram.SetupResult) error {
	switch {
	case result.OK:
		return nil
	case result.Status == 0:
		return commands.Refusal("Telegram didn't answer. Try again.")
	}
	return commands.Refusal(fmt.Sprintf("Telegram refused (HTTP %d). Check the bot's token.", result.Status))
}
