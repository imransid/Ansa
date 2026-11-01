package brainclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// The longest answer core reads from the brain.
const maxAnswerBytes = 1 << 20

// ErrBrainUnavailable means the brain didn't answer usefully (down, too slow,
// refused, or an answer that isn't the expected JSON). Callers then fall back
// to the safe path (for the assistant: the holding reply and an alert).
var ErrBrainUnavailable = errors.New("the brain didn't answer")

// Client sends signed requests to the brain.
type Client struct {
	baseURL string
	secret  string
	http    *http.Client
}

// New makes a client for the brain at baseURL. timeout covers one whole request.
func New(baseURL, secret string, timeout time.Duration) *Client {
	return &Client{baseURL: baseURL, secret: secret, http: &http.Client{Timeout: timeout}}
}

// Call posts request (as JSON) to path and reads the answer into answer.
func (c *Client) Call(ctx context.Context, path string, request, answer any) error {
	body, err := json.Marshal(request)
	if err != nil {
		return fmt.Errorf("encoding the brain request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("making the brain request: %w", err)
	}
	timestamp, signature := Sign(c.secret, body, time.Now())
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(TimestampHeader, timestamp)
	req.Header.Set(SignatureHeader, signature)
	res, err := c.http.Do(req)
	if err != nil {
		return ErrBrainUnavailable
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return ErrBrainUnavailable
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, maxAnswerBytes)).Decode(answer); err != nil {
		return ErrBrainUnavailable
	}
	return nil
}
