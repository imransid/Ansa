package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"
)

// The bot's own setup (the old adapters/telegram.ts): where Telegram sends
// its updates (ansa's operator: `go run ./cmd/operator telegram-webhook`),
// and reading them by long polling (development: `go run ./cmd/simulate
// telegram-poll`). As for sending, the token is in every address: no
// address, error or answer is logged, and only ok, the updates and the
// HTTP status are read (never Telegram's own words).

// UpdateTypes are the updates ansa reads, asked for by the webhook and the poll alike.
var UpdateTypes = []string{"message", "business_connection", "business_message", "deleted_business_messages"}

// A long poll waits this long for an update; its request a little longer.
const pollWaitSeconds = 25

var pollClient = &http.Client{
	Timeout:       (pollWaitSeconds + 10) * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

// SetupResult is Telegram's answer to setWebhook or deleteWebhook.
type SetupResult struct {
	OK bool
	// The HTTP status of a refusal; 0 when Telegram didn't answer.
	Status int
}

// SetWebhook tells Telegram to send the bot's updates to url, with the
// secret it sends back in X-Telegram-Bot-Api-Secret-Token.
func SetWebhook(ctx context.Context, token, url, secret string) SetupResult {
	payload := map[string]any{"url": url, "secret_token": secret, "allowed_updates": UpdateTypes, "max_connections": 40}
	return setup(ctx, token, "setWebhook", payload)
}

// DeleteWebhook takes the webhook off, so the bot's updates wait for
// getUpdates (a development bot).
func DeleteWebhook(ctx context.Context, token string) SetupResult {
	return setup(ctx, token, "deleteWebhook", map[string]any{})
}

func setup(ctx context.Context, token, method string, payload map[string]any) SetupResult {
	status, answer := callBotAPI(ctx, client, token, method, payload)
	var read struct {
		OK bool `json:"ok"`
	}
	if status == http.StatusOK && json.Unmarshal(answer, &read) == nil && read.OK {
		return SetupResult{OK: true}
	}
	return SetupResult{Status: status}
}

// PollResult is one getUpdates answer.
type PollResult struct {
	OK bool
	// Each update as Telegram sent it (handed to the webhook's code as it is).
	Updates []json.RawMessage
	// Telegram refuses polling (409) while the bot has a webhook.
	WebhookSet bool
	// The HTTP status of a failed read; 0 when Telegram didn't answer.
	Status int
}

// GetUpdates reads the bot's waiting updates from offset on, waiting up to
// 25 seconds for one.
func GetUpdates(ctx context.Context, token string, offset int64) PollResult {
	payload := map[string]any{"offset": offset, "timeout": pollWaitSeconds, "allowed_updates": UpdateTypes}
	status, answer := callBotAPI(ctx, pollClient, token, "getUpdates", payload)
	if status == http.StatusConflict {
		return PollResult{WebhookSet: true, Status: status}
	}
	var read struct {
		OK     bool              `json:"ok"`
		Result []json.RawMessage `json:"result"`
	}
	if status == http.StatusOK && json.Unmarshal(answer, &read) == nil && read.OK {
		return PollResult{OK: true, Updates: read.Result}
	}
	return PollResult{Status: status}
}

// callBotAPI posts one method and returns the HTTP status (0 = no answer)
// and the answer, at most 10 MB.
func callBotAPI(ctx context.Context, httpClient *http.Client, token, method string, payload map[string]any) (int, []byte) {
	body, _ := json.Marshal(payload)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, APIHost+"/bot"+token+"/"+method, bytes.NewReader(body))
	if err != nil {
		return 0, nil
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := httpClient.Do(request)
	if err != nil {
		return 0, nil
	}
	defer response.Body.Close()
	answer, err := io.ReadAll(io.LimitReader(response.Body, 10<<20))
	if err != nil {
		return 0, nil
	}
	return response.StatusCode, answer
}
