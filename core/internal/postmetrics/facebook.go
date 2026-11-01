package postmetrics

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"time"

	"ansa/core/internal/messenger"
)

// Numbers is one snapshot's numbers: nil = the platform doesn't give it
// (never 0 for unknown).
type Numbers struct {
	Reactions, Comments, Shares *int64
}

// The largest count Postgres's integer column holds.
const countMax = 2_147_483_647

var graphClient = &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

var facebookPostID = regexp.MustCompile(`^[\d_]{1,60}$`)

// limit(0): only the totals, never the people who reacted or commented
// (that Meta takes limit(0) is NOT CONFIRMED; a refusal is invalid_request).
const facebookFields = "shares,reactions.limit(0).summary(total_count),comments.limit(0).summary(true)"

// Meta's error codes for reading (the error-handling guide), besides throttling.
var facebookFailures = map[int]string{190: "token_rejected", 10: "permission_denied", 100: "invalid_request", 1: "server_error", 2: "server_error"}

var throttled = map[int]bool{4: true, 17: true, 32: true, 341: true, 613: true, 80001: true}

// ReadFacebook reads one Page post's reactions, comments and shares in one
// GET with the Page's token (the old adapters/facebook-metrics.ts). Views,
// viewers and clicks are Page insights, which need read_insights: ansa
// doesn't ask for it. A failure is a code; Meta's words are never read.
// NOT TESTED against Facebook.
func ReadFacebook(ctx context.Context, appSecret, postID, pageToken string) (Numbers, string) {
	if !facebookPostID.MatchString(postID) {
		return Numbers{}, "invalid_request"
	}
	query := url.Values{"fields": {facebookFields}, "access_token": {pageToken}, "appsecret_proof": {messenger.AppSecretProof(pageToken, appSecret)}}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, messenger.GraphURL+"/"+postID+"?"+query.Encode(), nil)
	if err != nil {
		return Numbers{}, "invalid_request"
	}
	response, err := graphClient.Do(request)
	if err != nil {
		if ctx.Err() != nil || isTimeout(err) {
			return Numbers{}, "timeout"
		}
		return Numbers{}, "network_error"
	}
	defer response.Body.Close()
	var answer struct {
		Shares *struct {
			Count *int64 `json:"count"`
		} `json:"shares"`
		Reactions *struct {
			Summary *struct {
				Total *int64 `json:"total_count"`
			} `json:"summary"`
		} `json:"reactions"`
		Comments *struct {
			Summary *struct {
				Total *int64 `json:"total_count"`
			} `json:"summary"`
		} `json:"comments"`
		Error *struct {
			Code int `json:"code"`
		} `json:"error"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&answer) != nil && response.StatusCode/100 == 2 {
		return Numbers{}, "unexpected_answer"
	}
	if response.StatusCode/100 != 2 {
		code := -1
		if answer.Error != nil {
			code = answer.Error.Code
		}
		return Numbers{}, failureOf(response.StatusCode, code)
	}
	var numbers Numbers
	if answer.Reactions != nil && answer.Reactions.Summary != nil {
		numbers.Reactions = answer.Reactions.Summary.Total
	}
	if answer.Comments != nil && answer.Comments.Summary != nil {
		numbers.Comments = answer.Comments.Summary.Total
	}
	if answer.Shares != nil {
		numbers.Shares = answer.Shares.Count
	}
	for _, count := range []*int64{numbers.Reactions, numbers.Comments, numbers.Shares} {
		if count != nil && (*count < 0 || *count > countMax) {
			return Numbers{}, "unexpected_answer"
		}
	}
	if numbers.Reactions == nil && numbers.Comments == nil && numbers.Shares == nil {
		return Numbers{}, "no_numbers"
	}
	return numbers, ""
}

func failureOf(status, code int) string {
	switch {
	case throttled[code]:
		return "rate_limited"
	case facebookFailures[code] != "":
		return facebookFailures[code]
	case code >= 200 && code <= 299:
		return "permission_denied"
	case status >= 500:
		return "server_error"
	}
	return "unexpected_answer"
}

func isTimeout(err error) bool {
	timeout, ok := err.(interface{ Timeout() bool })
	return ok && timeout.Timeout()
}
