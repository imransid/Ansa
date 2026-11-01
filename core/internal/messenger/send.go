package messenger

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// GraphURL is Meta's Graph API (a test replaces it). One version for every call.
var GraphURL = "https://graph.facebook.com/v26.0"

// TextMax is Meta's longest text message; a longer one goes as several.
const TextMax = 2_000

var graphClient = &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

// Result of one send: Status "sent", "failed" or "unclear"; Error a code.
type Result struct {
	Status, ChannelMessageID, Error string
}

// Meta's codes: a message outside the 24 hours, an invalid token, throttling.
const (
	outsideWindowCode    = 10
	outsideWindowSubcode = 2018278
	invalidTokenCode     = 190
)

var throttledCodes = map[int]bool{4: true, 17: true, 32: true, 341: true, 613: true, 80001: true}

// AppSecretProof is the token signed with ansa's app secret, sent with every
// call made with a token: a token copied elsewhere is useless without it.
func AppSecretProof(token, appSecret string) string {
	mac := hmac.New(sha256.New, []byte(appSecret))
	mac.Write([]byte(token))
	return hex.EncodeToString(mac.Sum(nil))
}

// Send replies to a customer through the Page (Send API, messaging_type
// RESPONSE: only within 24 hours of their message). A part after the first
// that fails leaves the result "unclear": the customer has some of it.
// Meta's words are never read; nothing here logs (the token is in the address).
func Send(ctx context.Context, appSecret, pageID, pageToken, psid, text string) Result {
	first := ""
	for index, part := range SplitText(text) {
		result := sendPart(ctx, appSecret, pageID, pageToken, psid, part)
		if result.Status != "sent" {
			if index == 0 {
				return result
			}
			return Result{Status: "unclear", Error: "no_answer"}
		}
		if first == "" {
			first = result.ChannelMessageID
		}
	}
	return Result{Status: "sent", ChannelMessageID: first}
}

func sendPart(ctx context.Context, appSecret, pageID, pageToken, psid, text string) Result {
	query := url.Values{"access_token": {pageToken}, "appsecret_proof": {AppSecretProof(pageToken, appSecret)}}
	body, _ := json.Marshal(map[string]any{"recipient": map[string]string{"id": psid}, "messaging_type": "RESPONSE", "message": map[string]string{"text": text}})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, GraphURL+"/"+url.PathEscape(pageID)+"/messages?"+query.Encode(), bytes.NewReader(body))
	if err != nil {
		return Result{Status: "failed", Error: "refused"}
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := graphClient.Do(request)
	if err != nil {
		return Result{Status: "unclear", Error: "no_answer"}
	}
	defer response.Body.Close()
	var answer struct {
		MessageID string `json:"message_id"`
		Error     *struct {
			Code    int `json:"code"`
			Subcode int `json:"error_subcode"`
		} `json:"error"`
	}
	json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&answer)
	switch {
	case response.StatusCode/100 == 2 && answer.MessageID != "" && len(answer.MessageID) <= 500:
		return Result{Status: "sent", ChannelMessageID: answer.MessageID}
	case response.StatusCode/100 == 2 || response.StatusCode >= 500:
		return Result{Status: "unclear", Error: "no_answer"}
	case answer.Error != nil && answer.Error.Code == outsideWindowCode && answer.Error.Subcode == outsideWindowSubcode:
		return Result{Status: "failed", Error: "reply_window_closed"}
	case answer.Error != nil && throttledCodes[answer.Error.Code]:
		return Result{Status: "failed", Error: "rate_limited"}
	case answer.Error != nil && answer.Error.Code == invalidTokenCode:
		return Result{Status: "failed", Error: "not_connected"}
	}
	return Result{Status: "failed", Error: "refused"}
}

// Name is the customer's name as Meta gives it to the Page, or "".
func Name(ctx context.Context, appSecret, psid, pageToken string) string {
	query := url.Values{"fields": {"first_name,last_name"}, "access_token": {pageToken}, "appsecret_proof": {AppSecretProof(pageToken, appSecret)}}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, GraphURL+"/"+url.PathEscape(psid)+"?"+query.Encode(), nil)
	if err != nil {
		return ""
	}
	response, err := graphClient.Do(request)
	if err != nil {
		return ""
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return ""
	}
	var names struct {
		First string `json:"first_name"`
		Last  string `json:"last_name"`
	}
	json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&names)
	if len(names.First) > 200 || len(names.Last) > 200 {
		return ""
	}
	return strings.TrimSpace(strings.TrimSpace(names.First) + " " + strings.TrimSpace(names.Last))
}

// SplitText cuts a text into parts of at most TextMax characters, each
// after a line break or a space when there is one in its second half.
func SplitText(text string) []string {
	var parts []string
	rest := []rune(text)
	for len(rest) > TextMax {
		window := rest[:TextMax]
		cut := -1
		for i := len(window) - 1; i > TextMax/2; i-- {
			if window[i] == '\n' || window[i] == ' ' {
				cut = i
				break
			}
		}
		at := TextMax
		if cut > 0 {
			at = cut + 1
		}
		if part := strings.TrimRight(string(rest[:at]), " \n\t"); part != "" {
			parts = append(parts, part)
		}
		rest = rest[at:]
	}
	if len(rest) > 0 {
		parts = append(parts, string(rest))
	}
	return parts
}
