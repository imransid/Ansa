package platforms

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// What every request to a platform does the same way (the old
// lib/social-http.ts): its own time limit, which covers reading the answer
// too; no redirect followed (a token must never follow one to another
// host); at most 1 MB of answer read, and only the fields used. Nothing a
// platform wrote is ever kept or logged.

// The time limits of one request.
const (
	// A call to a platform's API or token endpoint.
	APITimeout = 15 * time.Second
	// Sending one image.
	ImageUploadTimeout = 60 * time.Second
	// Sending one video (the media library keeps files up to 100 MB).
	VideoUploadTimeout = 180 * time.Second
)

// Platforms answer in kilobytes; anything bigger is not an answer ansa uses.
const maxAnswerBytes = 1 << 20

// request is one call to a platform.
type request struct {
	method, address string
	header          map[string]string
	body            []byte
	timeout         time.Duration
}

// answer is what came back: the status, the headers and the body (nil when
// over 1 MB or cut off), or noAnswer ("timeout", "network_error").
type answer struct {
	status   int
	header   http.Header
	body     []byte
	noAnswer string
}

func (a answer) answered() bool { return a.noAnswer == "" }

func (a answer) ok() bool { return a.answered() && a.status >= 200 && a.status < 300 }

// send makes one request. An error's text can name the address: only its
// kind is kept.
func (c *Connectors) send(ctx context.Context, r request) answer {
	ctx, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()
	outgoing, err := http.NewRequestWithContext(ctx, r.method, r.address, bytes.NewReader(r.body))
	if err != nil {
		return answer{noAnswer: "network_error"}
	}
	for name, value := range r.header {
		outgoing.Header.Set(name, value)
	}
	client := &http.Client{Transport: c.Transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(outgoing)
	if err != nil {
		if ctx.Err() != nil || isTimeout(err) {
			return answer{noAnswer: "timeout"}
		}
		return answer{noAnswer: "network_error"}
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, maxAnswerBytes+1))
	if err != nil || len(body) > maxAnswerBytes {
		body = nil
	}
	return answer{status: response.StatusCode, header: response.Header, body: body}
}

func isTimeout(err error) bool {
	var timeout interface{ Timeout() bool }
	return errors.As(err, &timeout) && timeout.Timeout()
}

// readJSON reads an answer's body into `into`; false when it is missing,
// too large, cut off or not JSON of that shape.
func readJSON(a answer, into any) bool {
	return a.body != nil && json.Unmarshal(a.body, into) == nil
}

// readJSONIfOK is readJSON for a 2xx answer only.
func readJSONIfOK(a answer, into any) bool {
	return a.ok() && readJSON(a, into)
}

// bearerGet is a GET with an account's token.
func bearerGet(address, token string) request {
	return request{method: http.MethodGet, address: address, header: map[string]string{"Authorization": "Bearer " + token}, timeout: APITimeout}
}

// formPost is a POST of a form (application/x-www-form-urlencoded).
func formPost(address string, form url.Values, header map[string]string) request {
	if header == nil {
		header = map[string]string{}
	}
	header["Content-Type"] = "application/x-www-form-urlencoded"
	return request{method: http.MethodPost, address: address, header: header, body: []byte(form.Encode()), timeout: APITimeout}
}

// basicAuthorization is "Basic <base64 of id:secret>", how X's token
// endpoint wants a confidential client.
func basicAuthorization(app App) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(app.ClientID+":"+app.ClientSecret))
}

// queryString writes name=value pairs in their order, the way the
// platforms' docs write them (a space as %20: "openid%20profile").
func queryString(pairs ...string) string {
	parts := make([]string, 0, len(pairs)/2)
	for i := 0; i+1 < len(pairs); i += 2 {
		parts = append(parts, encodeComponent(pairs[i])+"="+encodeComponent(pairs[i+1]))
	}
	return strings.Join(parts, "&")
}

func encodeComponent(value string) string {
	return strings.ReplaceAll(url.QueryEscape(value), "+", "%20")
}
