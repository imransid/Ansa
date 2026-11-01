package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"
)

// The bot's token is part of every address, so no address, error or answer
// of Telegram's is ever logged or kept; Telegram's own words ("description")
// are never read: only ok, the message id and the HTTP status.

// APIHost is Telegram's Bot API (a test replaces it).
var APIHost = "https://api.telegram.org"

// Result of one send, as the conversation records it.
type Result struct {
	// "sent", "failed" or "unclear" (Telegram may have it: never sent again by itself).
	Status string
	// The message's id in Telegram, when sent.
	ChannelMessageID string
	// Why it failed: rate_limited, bot_rejected, refused, no_answer.
	Error string
}

var client = &http.Client{
	Timeout: 15 * time.Second,
	// Never follow a redirect with the token in the address.
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// Send sends one text message: to a customer on behalf of a business's
// account (businessConnectionID), or to the owner in the bot's own chat ("").
func Send(ctx context.Context, token, chatID, text, businessConnectionID string) Result {
	payload := map[string]string{"chat_id": chatID, "text": text}
	if businessConnectionID != "" {
		payload["business_connection_id"] = businessConnectionID
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, APIHost+"/bot"+token+"/sendMessage", bytes.NewReader(body))
	if err != nil {
		return Result{Status: "failed", Error: "refused"}
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return Result{Status: "unclear", Error: "no_answer"}
	}
	defer res.Body.Close()
	if res.StatusCode >= 500 {
		return Result{Status: "unclear", Error: "no_answer"}
	}
	var answer struct {
		OK     bool `json:"ok"`
		Result *struct {
			MessageID json.Number `json:"message_id"`
		} `json:"result"`
	}
	decodeErr := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&answer)
	if res.StatusCode == http.StatusOK && decodeErr == nil && answer.OK && answer.Result != nil {
		if id, err := strconv.ParseInt(answer.Result.MessageID.String(), 10, 64); err == nil {
			return Result{Status: "sent", ChannelMessageID: strconv.FormatInt(id, 10)}
		}
	}
	return Result{Status: "failed", Error: refusalCode(res.StatusCode)}
}

// refusalCode reads a refusal by its HTTP status only.
func refusalCode(status int) string {
	switch {
	case status == http.StatusTooManyRequests:
		return "rate_limited"
	case status == http.StatusUnauthorized || status == http.StatusNotFound:
		// A wrong or revoked token.
		return "bot_rejected"
	default:
		return "refused"
	}
}

// ErrNoToken means ansa's bot isn't set up on this server.
var ErrNoToken = errors.New("telegram: no bot token")
