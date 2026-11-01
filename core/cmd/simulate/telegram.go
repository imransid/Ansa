package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"strings"

	"ansa/core/internal/commands"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/telegram"
)

// telegram brings a customer's Telegram message into the Inbox through the
// company's development stand-in Telegram account (the old `pnpm
// simulate:telegram`), so Telegram can be tried before ansa's bot exists:
// connect the stand-in on Settings → Connections first. It runs IN THIS
// PROCESS: the message is built as Telegram sends one and handed to core's
// Telegram webhook handler (with a secret made for this run), which saves
// it as every customer message. Each run is one new message from the
// customer named; the same name joins the same conversation. A running core
// answers it (its reply is a file in .dev-messages/).
var telegramTool = tool{
	usage: `telegram <owner email> "<customer name>" "<message>"`,
	does:  "writes a made-up customer message",
	fits:  exactly(3),
	run:   runTelegram,
}

func runTelegram(ctx context.Context, w *world, args []string) error {
	company, err := w.owner(ctx, args[0])
	if err != nil {
		return err
	}
	connection, err := commands.StandInTelegramConnection(ctx, w.pool, company.ID)
	if err != nil {
		return err
	}
	if connection == "" {
		return commands.Refusal(fmt.Sprintf("This company has no stand-in Telegram account. Connect one on %s/settings/channels first.", w.cfg.AppURL))
	}
	update := standInTelegramUpdate(connection, cutRunes(strings.TrimSpace(args[1]), 100), cutRunes(strings.TrimSpace(args[2]), 4000))
	secret := randomHex(32)
	hook := &telegram.Webhook{Pool: w.pool, Limiter: ratelimit.New(w.pool, w.cfg.AuthSecret), Box: w.box, Log: logging.New(os.Stderr), Secret: secret}
	if status := serveInProcess(hook, "/webhooks/telegram", update, telegramSecretHeader(secret)); status != http.StatusOK {
		return commands.Refusal(fmt.Sprintf("Core's Telegram webhook answered HTTP %d: nothing was saved.", status))
	}
	fmt.Fprintf(w.out, "Saved a Telegram message for %q. A running core answers it in a moment (see .dev-messages/ and %s/inbox?view=all).\n", company.Name, w.cfg.AppURL)
	return nil
}

// standInTelegramUpdate is a customer's message as Telegram sends one to a
// business's chatbot.
func standInTelegramUpdate(businessConnectionID, customerName, text string) []byte {
	customerID := standInTelegramCustomerID(customerName)
	update, _ := json.Marshal(map[string]any{
		"update_id": randomTelegramID(),
		"business_message": map[string]any{
			"message_id":             randomTelegramID(),
			"business_connection_id": businessConnectionID,
			"chat":                   map[string]any{"id": customerID, "type": "private", "first_name": customerName},
			"from":                   map[string]any{"id": customerID, "is_bot": false, "first_name": customerName},
			"text":                   text,
		},
	})
	return update
}

// standInTelegramCustomerID: the same name is the same made-up Telegram
// customer (a whole number from the name's hash, as the old script made it,
// so the old simulator's conversations continue).
func standInTelegramCustomerID(name string) uint64 {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(name))))
	var six [8]byte
	copy(six[2:], sum[:6])
	return binary.BigEndian.Uint64(six[:])
}

// randomTelegramID is a made-up id from 1 to 2^31 - 1, as Telegram's are.
func randomTelegramID() int64 {
	n, _ := rand.Int(rand.Reader, big.NewInt(1<<31-1))
	return n.Int64() + 1
}

func telegramSecretHeader(secret string) http.Header {
	return http.Header{"X-Telegram-Bot-Api-Secret-Token": []string{secret}}
}
