package whatsapp

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"time"
	"unicode/utf8"
)

// GraphURL is Meta's Graph API (a test replaces it): the same version as
// Messenger's.
var GraphURL = "https://graph.facebook.com/v26.0"

// TextMax is WhatsApp's longest text message (ansa's replies are shorter).
const TextMax = 4_096

var graphClient = &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

// Result of one send: Status "sent", "failed" or "unclear"; Error a code.
type Result struct {
	Status, ChannelMessageID, Error string
}

// Meta's codes: a message outside the 24 hours, a token that no longer
// works, a number no longer registered, and throttling.
const (
	outsideWindowCode = 131047
	invalidTokenCode  = 190
	notRegisteredCode = 133010
)

var throttledCodes = map[int]bool{4: true, 80007: true, 130429: true, 131056: true}

// graphError is Meta's error, read for its code only (never its words).
type graphError struct {
	Error *graphFailure `json:"error"`
}

type graphFailure struct {
	Code int `json:"code"`
}

type sentMessage struct {
	ID string `json:"id"`
}

// Send replies to a customer from the business's number (only within 24
// hours of their message: Meta's rule). The token goes in a header, never
// the address; Meta's words are never read or logged.
func Send(ctx context.Context, appSecret, phoneNumberID, token, customer, text string) Result {
	if utf8.RuneCountInString(text) > TextMax {
		return Result{Status: "failed", Error: "refused"}
	}
	message := map[string]any{"messaging_product": "whatsapp", "recipient_type": "individual", "type": "text", "text": map[string]any{"preview_url": false, "body": text}}
	if isUserID(customer) {
		message["recipient"] = customer
	} else {
		message["to"] = customer
	}
	body, _ := json.Marshal(message)
	response, err := callGraph(ctx, http.MethodPost, "/"+url.PathEscape(phoneNumberID)+"/messages", appSecret, token, body)
	if err != nil {
		return Result{Status: "unclear", Error: "no_answer"}
	}
	defer response.Body.Close()
	var answer struct {
		Messages []sentMessage `json:"messages"`
		graphError
	}
	json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&answer)
	return sendResult(response.StatusCode, answer.Messages, answer.Error)
}

// sendResult reads Meta's answer: the message's id, or why it didn't go.
func sendResult(status int, messages []sentMessage, failure *graphFailure) Result {
	switch {
	case status/100 == 2 && len(messages) > 0 && messages[0].ID != "" && len(messages[0].ID) <= 500:
		return Result{Status: "sent", ChannelMessageID: messages[0].ID}
	case status/100 == 2 || status >= 500:
		return Result{Status: "unclear", Error: "no_answer"}
	case failure != nil && failure.Code == outsideWindowCode:
		return Result{Status: "failed", Error: "reply_window_closed"}
	case failure != nil && throttledCodes[failure.Code]:
		return Result{Status: "failed", Error: "rate_limited"}
	case failure != nil && (failure.Code == invalidTokenCode || failure.Code == notRegisteredCode):
		return Result{Status: "failed", Error: "not_connected"}
	}
	return Result{Status: "failed", Error: "refused"}
}
