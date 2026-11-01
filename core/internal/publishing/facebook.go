package publishing

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"ansa/core/internal/messenger"
)

// PostResult is what a platform said to one post. Kind "published" (with
// PostID and maybe URL), "not_created" (nothing went out: Code says why) or
// "unclear" (it may be up: a person checks; never sent again by itself).
type PostResult struct {
	Kind, Code, PostID, URL string
	// A "slow down" (rate_limited) with how long the platform asked to wait; 0 = it didn't say.
	RetryAfterSeconds int
}

// How long one Graph API call may take.
const facebookTimeout = 15 * time.Second

var facebookClient = &http.Client{Timeout: facebookTimeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

var facebookPostID = regexp.MustCompile(`^[\d_]{1,60}$`)

// Meta's error-handling guide: these codes created nothing (besides throttling).
var facebookNotCreated = map[int]string{506: "duplicate", 190: "token_rejected", 10: "permission_denied", 368: "blocked_by_policy", 100: "invalid_request", 1609005: "link_error"}

var facebookThrottled = map[int]bool{4: true, 17: true, 32: true, 341: true, 613: true, 80001: true}

// PublishToFacebook posts a text to a Page's /feed (the old
// adapters/facebook-posts.ts), with appsecret_proof. The call creates the
// post itself, so no answer, a 5xx or an answer without an id is unclear.
// Meta's words are never read or logged (the token is in the body).
// NOT TESTED against Facebook (ansa's Meta app needs App Review first).
func PublishToFacebook(ctx context.Context, appSecret, pageID, pageToken, text string) PostResult {
	form := url.Values{"message": {text}, "access_token": {pageToken}, "appsecret_proof": {messenger.AppSecretProof(pageToken, appSecret)}}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, messenger.GraphURL+"/"+url.PathEscape(pageID)+"/feed", strings.NewReader(form.Encode()))
	if err != nil {
		return PostResult{Kind: "not_created", Code: "invalid_request"}
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := facebookClient.Do(request)
	if err != nil {
		return PostResult{Kind: "unclear", Code: "no_answer"}
	}
	defer response.Body.Close()
	var answer struct {
		ID     string `json:"id"`
		PostID string `json:"post_id"`
		Error  *struct {
			Code int `json:"code"`
		} `json:"error"`
	}
	decodeErr := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&answer)
	if response.StatusCode/100 == 2 {
		id := answer.PostID
		if id == "" {
			id = answer.ID
		}
		if decodeErr != nil || !facebookPostID.MatchString(id) {
			// It may well be up, but there's nothing to point at.
			return PostResult{Kind: "unclear", Code: "no_post_id"}
		}
		return PostResult{Kind: "published", PostID: id, URL: "https://www.facebook.com/" + id}
	}
	code := -1
	if answer.Error != nil {
		code = answer.Error.Code
	}
	return facebookRefusal(response, code)
}

// facebookRefusal is what a Graph error means: the listed codes created
// nothing; 1 and 2 are temporary and unclear; anything else, a 5xx
// included, is unclear.
func facebookRefusal(response *http.Response, code int) PostResult {
	switch {
	case facebookThrottled[code]:
		return PostResult{Kind: "not_created", Code: "rate_limited", RetryAfterSeconds: secondsToRegainAccess(response.Header.Get("X-Business-Use-Case-Usage"))}
	case facebookNotCreated[code] != "":
		return PostResult{Kind: "not_created", Code: facebookNotCreated[code]}
	case code >= 200 && code <= 299:
		return PostResult{Kind: "not_created", Code: "permission_denied"}
	case code == 1 || code == 2:
		return PostResult{Kind: "unclear", Code: "temporary_error"}
	case response.StatusCode >= 500:
		return PostResult{Kind: "unclear", Code: "server_error"}
	}
	return PostResult{Kind: "unclear", Code: "unexpected_answer"}
}

// secondsToRegainAccess reads Meta's usage header: per business, minutes
// until calls work again. The longest wait in seconds, 0 = not said.
func secondsToRegainAccess(header string) int {
	var usage map[string][]struct {
		Minutes float64 `json:"estimated_time_to_regain_access"`
	}
	if json.Unmarshal([]byte(header), &usage) != nil {
		return 0
	}
	longest := 0.0
	for _, entries := range usage {
		for _, entry := range entries {
			if entry.Minutes > longest {
				longest = entry.Minutes
			}
		}
	}
	return int(longest * 60)
}
