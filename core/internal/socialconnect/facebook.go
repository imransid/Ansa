package socialconnect

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
	"ansa/core/internal/plaintext"
)

// DialogURL is Facebook's consent screen (a test replaces it), the Graph
// API's version as every other call's.
var DialogURL = "https://www.facebook.com/v26.0/dialog/oauth"

// What posting to a Page needs (all three), and what answering its
// Messenger messages needs (a person may untick these: posts still work).
var (
	postingScopes   = []string{"pages_show_list", "pages_read_engagement", "pages_manage_posts"}
	messagingScopes = []string{"pages_messaging", "pages_manage_metadata"}
	allScopes       = append(append([]string{}, postingScopes...), messagingScopes...)
)

// The Pages asked for at once (a person managing more is rare: a known gap).
const pagesPerRequest = 100

var graphClient = &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

var pageIDPattern = regexp.MustCompile(`^\d{1,30}$`)

// Account is one account a platform authorized: for Facebook, one Page.
type Account struct {
	ExternalID, DisplayName, Kind string
	Scopes                        []string
	AccessToken                   string
}

// authorizeURL is the consent screen's address: no PKCE (Facebook's flow
// documents none), the state proving the return answers this attempt.
func authorizeURL(appID, redirectURI, state string) string {
	query := url.Values{"client_id": {appID}, "redirect_uri": {redirectURI}, "state": {state}, "response_type": {"code"}, "scope": {strings.Join(allScopes, ",")}}
	return DialogURL + "?" + query.Encode()
}

// facebookPages turns the code into one account per Page the person may
// create content on, each with its own Page token (which doesn't expire
// when it comes from a long-lived user token). The user token itself is
// never kept. A failure is a result code: exchange_failed,
// missing_permission or no_pages. NOT TESTED against Facebook.
func facebookPages(ctx context.Context, appID, appSecret, redirectURI, code string) ([]Account, string) {
	shortLived := getToken(ctx, url.Values{"client_id": {appID}, "redirect_uri": {redirectURI}, "client_secret": {appSecret}, "code": {code}})
	if shortLived == "" {
		return nil, "exchange_failed"
	}
	longLived := getToken(ctx, url.Values{"grant_type": {"fb_exchange_token"}, "client_id": {appID}, "client_secret": {appSecret}, "fb_exchange_token": {shortLived}})
	if longLived == "" {
		return nil, "exchange_failed"
	}
	var permissions struct {
		Data []struct {
			Permission string `json:"permission"`
			Status     string `json:"status"`
		} `json:"data"`
	}
	var pages struct {
		Data []struct {
			ID          string   `json:"id"`
			Name        string   `json:"name"`
			AccessToken string   `json:"access_token"`
			Tasks       []string `json:"tasks"`
		} `json:"data"`
	}
	if !graphGet(ctx, "/me/permissions", url.Values{}, longLived, appSecret, &permissions) ||
		!graphGet(ctx, "/me/accounts", url.Values{"fields": {"id,name,access_token,tasks"}, "limit": {"100"}}, longLived, appSecret, &pages) ||
		len(pages.Data) > pagesPerRequest {
		return nil, "exchange_failed"
	}
	granted := map[string]bool{}
	for _, entry := range permissions.Data {
		if entry.Status == "granted" {
			granted[entry.Permission] = true
		}
	}
	for _, scope := range postingScopes {
		if !granted[scope] {
			return nil, "missing_permission"
		}
	}
	var scopes []string
	for _, scope := range allScopes {
		if granted[scope] {
			scopes = append(scopes, scope)
		}
	}
	var accounts []Account
	for _, page := range pages.Data {
		if !pageIDPattern.MatchString(page.ID) || page.AccessToken == "" || len(page.AccessToken) > 8000 || !contains(page.Tasks, "CREATE_CONTENT") {
			continue
		}
		accounts = append(accounts, Account{ExternalID: page.ID, DisplayName: displayName(page.Name, "Facebook Page"), Kind: "page", Scopes: scopes, AccessToken: page.AccessToken})
	}
	if len(accounts) == 0 {
		return nil, "no_pages"
	}
	return accounts, ""
}

// getToken is GET /oauth/access_token with the parameters in the query, as
// Facebook's docs write it: the token, or "".
func getToken(ctx context.Context, params url.Values) string {
	var answer struct {
		AccessToken string `json:"access_token"`
	}
	if !getJSON(ctx, messenger.GraphURL+"/oauth/access_token?"+params.Encode(), &answer) || len(answer.AccessToken) > 8000 {
		return ""
	}
	return answer.AccessToken
}

// graphGet is one GET of the Graph API with a token and its appsecret_proof.
func graphGet(ctx context.Context, path string, params url.Values, token, appSecret string, into any) bool {
	params.Set("access_token", token)
	params.Set("appsecret_proof", messenger.AppSecretProof(token, appSecret))
	return getJSON(ctx, messenger.GraphURL+path+"?"+params.Encode(), into)
}

// getJSON reads a 2xx answer's JSON (at most 1 MB). Meta's words are never
// read or logged: the token is in the address.
func getJSON(ctx context.Context, address string, into any) bool {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return false
	}
	response, err := graphClient.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	return response.StatusCode/100 == 2 && json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(into) == nil
}

// subscribeToMessages switches a Page's messages on for ansa's app
// (subscribed_apps: messages and message_echoes), so Meta sends them to
// ansa's webhook. True when Meta says it worked.
func subscribeToMessages(ctx context.Context, appSecret string, page Account) bool {
	form := url.Values{"subscribed_fields": {"messages,message_echoes"}, "access_token": {page.AccessToken}, "appsecret_proof": {messenger.AppSecretProof(page.AccessToken, appSecret)}}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, messenger.GraphURL+"/"+url.PathEscape(page.ExternalID)+"/subscribed_apps", strings.NewReader(form.Encode()))
	if err != nil {
		return false
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := graphClient.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	var answer struct {
		Success bool `json:"success"`
	}
	return response.StatusCode/100 == 2 && json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&answer) == nil && answer.Success
}

// displayName is a platform's name as one plain line of 1-200, else the fallback.
func displayName(name, fallback string) string {
	line := plaintext.SingleLine(name)
	if line == "" || len([]rune(line)) > 200 {
		return fallback
	}
	return line
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
