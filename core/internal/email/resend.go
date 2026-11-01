package email

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

// SendTimeout: running out is a failed delivery, "timeout" (safe to try
// again: the idempotency key stops a second delivery).
const SendTimeout = 20 * time.Second

const resendAPI = "https://api.resend.com"

var resendClient = &http.Client{Timeout: SendTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

// sendWithResend sends through Resend's API (POST /emails). Only the code
// of a refusal is read ("validation_error"), never its message.
func (s *Sender) sendWithResend(ctx context.Context, message Message) Result {
	if s.ResendKey == "" {
		return Result{Error: "missing_api_key"}
	}
	payload := map[string]any{"from": message.From, "to": []string{message.To}, "subject": message.Subject, "html": message.HTML, "text": message.Text}
	if message.ReplyTo != "" {
		payload["reply_to"] = message.ReplyTo
	}
	body, _ := json.Marshal(payload)
	ctx, cancel := context.WithTimeout(ctx, SendTimeout)
	defer cancel()
	base := s.ResendURL
	if base == "" {
		base = resendAPI
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/emails", bytes.NewReader(body))
	if err != nil {
		return Result{Error: "unknown_error"}
	}
	request.Header.Set("Authorization", "Bearer "+s.ResendKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", message.IdempotencyKey)
	response, err := resendClient.Do(request)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return Result{Error: "timeout"}
		}
		return Result{Error: "no_answer"}
	}
	defer response.Body.Close()
	var answer struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(&answer)
	if response.StatusCode/100 != 2 || answer.ID == "" {
		return Result{Error: errorCode(answer.Name)}
	}
	return Result{OK: true, ProviderID: answer.ID}
}
