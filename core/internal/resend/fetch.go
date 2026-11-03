package resend

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"time"
)

// Content is a received email as Resend's Receiving API (or the development
// inbox) gives it. Nothing is refused: an odd field becomes empty, so the
// email still becomes a request.
type Content struct {
	From        string            `json:"from"`
	ReplyTo     []string          `json:"-"`
	Subject     string            `json:"subject"`
	Text        *string           `json:"text"`
	HTML        *string           `json:"html"`
	Attachments []Attachment      `json:"-"`
	Headers     map[string]string `json:"-"`
	// Resend's own SPF, DKIM and DMARC results (worked out when the email
	// arrived, not from headers a sender writes). nil: missing (not verified).
	Authentication *Authentication `json:"-"`
}

// Attachment is one file's name and the content id an HTML part refers to.
type Attachment struct {
	Filename  string
	ContentID string
}

// Authentication is Resend's results: "pass", "fail", "gray", "processing_failed" or "unknown".
type Authentication struct{ SPF, DKIM, DMARC string }

// Fetcher reads received emails' content.
type Fetcher struct {
	// Real: Resend's API with APIKey; otherwise files in DevFolder/.dev-inbound.
	Real      bool
	APIKey    string
	DevFolder string
	// Tests replace Resend's address and the waits between tries.
	BaseURL string
	Waits   []time.Duration
}

var resendIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,200}$`)

var fetchClient = &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

// Fetch is the email's content, or nil when it can't be had (logged by the
// caller as "content_unavailable"; "Process again" tries later).
func (f *Fetcher) Fetch(ctx context.Context, resendEmailID string) (*Content, string) {
	if !resendIDPattern.MatchString(resendEmailID) {
		return nil, "bad_id"
	}
	if !f.Real {
		raw, err := os.ReadFile(devInboundFile(f.DevFolder, resendEmailID))
		if err != nil {
			return nil, "no_dev_file"
		}
		return readContent(raw), ""
	}
	base := f.BaseURL
	if base == "" {
		base = resendAPI
	}
	waits := f.Waits
	if waits == nil {
		waits = []time.Duration{time.Second, 4 * time.Second}
	}
	code := ""
	for attempt := 0; attempt <= len(waits); attempt++ {
		if attempt > 0 {
			time.Sleep(waits[attempt-1])
		}
		var raw []byte
		var temporary bool
		raw, code, temporary = f.fetchOnce(ctx, base+"/emails/receiving/"+url.PathEscape(resendEmailID)+"?html_format=cid")
		if raw != nil {
			return readContent(raw), ""
		}
		if !temporary {
			break
		}
	}
	return nil, code
}

// fetchOnce: the answer, or a code ("401", "429", "no_answer") and whether
// trying again may help (429, 5xx, no answer).
func (f *Fetcher) fetchOnce(ctx context.Context, address string) ([]byte, string, bool) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, "bad_request", false
	}
	request.Header.Set("Authorization", "Bearer "+f.APIKey)
	response, err := fetchClient.Do(request)
	if err != nil {
		return nil, "no_answer", true
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, http.StatusText(response.StatusCode), response.StatusCode == 429 || response.StatusCode >= 500
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 50<<20))
	if err != nil {
		return nil, "no_answer", true
	}
	return raw, "", false
}

// readContent reads the JSON leniently: what isn't text becomes empty.
func readContent(raw []byte) *Content {
	var loose map[string]json.RawMessage
	c := &Content{Headers: map[string]string{}}
	if json.Unmarshal(raw, &loose) != nil {
		return c
	}
	json.Unmarshal(loose["from"], &c.From)
	json.Unmarshal(loose["subject"], &c.Subject)
	json.Unmarshal(loose["text"], &c.Text)
	json.Unmarshal(loose["html"], &c.HTML)
	c.ReplyTo = recipientList(loose["reply_to"])
	var headers map[string]any
	if json.Unmarshal(loose["headers"], &headers) == nil {
		for name, value := range headers {
			if text, ok := value.(string); ok {
				c.Headers[name] = text
			}
		}
	}
	var attachments []map[string]any
	if json.Unmarshal(loose["attachments"], &attachments) == nil {
		for _, a := range attachments {
			name, _ := a["filename"].(string)
			id, _ := a["content_id"].(string)
			c.Attachments = append(c.Attachments, Attachment{Filename: name, ContentID: id})
		}
	}
	var auth map[string]any
	if json.Unmarshal(loose["authentication"], &auth) == nil && auth != nil {
		result := func(name string) string {
			value, _ := auth[name].(string)
			switch value {
			case "pass", "fail", "gray", "processing_failed":
				return value
			}
			return "unknown"
		}
		c.Authentication = &Authentication{SPF: result("spf"), DKIM: result("dkim"), DMARC: result("dmarc")}
	}
	return c
}

const resendAPI = "https://api.resend.com"
