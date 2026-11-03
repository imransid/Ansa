package messenger

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// Answering a comment on a Page's post (core/internal/comments decides
// what; these calls only carry it): a public reply under the comment, and
// Meta's private reply, ONE Messenger message to whoever wrote it (within 7
// days of the comment). Every call sends the Page's token and its
// appsecret_proof; Meta's words are never read or logged (the token is in
// the address): only ids and status codes, errors as codes.

// PrivateReplyResult is a private reply's outcome, and the commenter's
// Page-scoped id when Meta names it (their Messenger conversation).
type PrivateReplyResult struct {
	Result
	RecipientID string
}

// ReplyUnderComment posts text as the Page's public reply to the comment
// (POST /{comment id}/comments). ChannelMessageID is the new comment's id.
func ReplyUnderComment(ctx context.Context, appSecret, commentID, pageToken, text string) Result {
	var answer struct {
		ID    string     `json:"id"`
		Error *metaError `json:"error"`
	}
	status, ok := postToGraph(ctx, appSecret, pageToken, "/"+url.PathEscape(commentID)+"/comments", map[string]any{"message": text}, &answer)
	if !ok {
		return Result{Status: "unclear", Error: "no_answer"}
	}
	if status/100 == 2 && metaObjectID.MatchString(answer.ID) {
		return Result{Status: "sent", ChannelMessageID: answer.ID}
	}
	return refusalOf(status, answer.Error)
}

// SendPrivateReply sends the ONE private message Meta allows for a comment
// (Send API, recipient {comment_id}, messaging_type RESPONSE). A text over
// TextMax is cut: there is no second message.
func SendPrivateReply(ctx context.Context, appSecret, pageID, pageToken, commentID, text string) PrivateReplyResult {
	if runes := []rune(text); len(runes) > TextMax {
		text = string(runes[:TextMax])
	}
	body := map[string]any{"recipient": map[string]string{"comment_id": commentID}, "messaging_type": "RESPONSE", "message": map[string]string{"text": text}}
	var answer struct {
		RecipientID string     `json:"recipient_id"`
		MessageID   string     `json:"message_id"`
		Error       *metaError `json:"error"`
	}
	status, ok := postToGraph(ctx, appSecret, pageToken, "/"+url.PathEscape(pageID)+"/messages", body, &answer)
	if !ok {
		return PrivateReplyResult{Result: Result{Status: "unclear", Error: "no_answer"}}
	}
	if status/100 == 2 && answer.MessageID != "" && len(answer.MessageID) <= 500 {
		recipient := ""
		if metaID.MatchString(answer.RecipientID) {
			recipient = answer.RecipientID
		}
		return PrivateReplyResult{Result: Result{Status: "sent", ChannelMessageID: answer.MessageID}, RecipientID: recipient}
	}
	return PrivateReplyResult{Result: refusalOf(status, answer.Error)}
}

// PostText is a Page post's own text (GET /{post id}?fields=message), cut
// to max characters; "" when Meta doesn't give it.
func PostText(ctx context.Context, appSecret, postID, pageToken string, max int) string {
	query := url.Values{"fields": {"message"}, "access_token": {pageToken}, "appsecret_proof": {AppSecretProof(pageToken, appSecret)}}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, GraphURL+"/"+url.PathEscape(postID)+"?"+query.Encode(), nil)
	if err != nil {
		return ""
	}
	response, err := graphClient.Do(request)
	if err != nil {
		return ""
	}
	defer response.Body.Close()
	var post struct {
		Message string `json:"message"`
	}
	if response.StatusCode/100 != 2 || json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&post) != nil {
		return ""
	}
	if runes := []rune(strings.TrimSpace(post.Message)); len(runes) > max {
		return string(runes[:max])
	}
	return strings.TrimSpace(post.Message)
}

// metaError is the only part of Meta's error ansa reads: its numbers.
type metaError struct {
	Code    int `json:"code"`
	Subcode int `json:"error_subcode"`
}

// postToGraph POSTs a JSON body with the token and its proof; the HTTP
// status and whether an answer came at all.
func postToGraph(ctx context.Context, appSecret, pageToken, path string, body map[string]any, into any) (int, bool) {
	query := url.Values{"access_token": {pageToken}, "appsecret_proof": {AppSecretProof(pageToken, appSecret)}}
	encoded, _ := json.Marshal(body)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, GraphURL+path+"?"+query.Encode(), bytes.NewReader(encoded))
	if err != nil {
		return 0, false
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := graphClient.Do(request)
	if err != nil {
		return 0, false
	}
	defer response.Body.Close()
	json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(into)
	return response.StatusCode, true
}

// refusalOf maps an answer that isn't a success to a result: a 2xx without
// what ansa needs, or a 5xx, may have worked ("unclear"); otherwise Meta's
// codes, as for messages.
func refusalOf(status int, problem *metaError) Result {
	switch {
	case status/100 == 2 || status >= 500:
		return Result{Status: "unclear", Error: "no_answer"}
	case problem != nil && problem.Code == outsideWindowCode && problem.Subcode == outsideWindowSubcode:
		return Result{Status: "failed", Error: "reply_window_closed"}
	case problem != nil && throttledCodes[problem.Code]:
		return Result{Status: "failed", Error: "rate_limited"}
	case problem != nil && problem.Code == invalidTokenCode:
		return Result{Status: "failed", Error: "not_connected"}
	}
	return Result{Status: "failed", Error: "refused"}
}
