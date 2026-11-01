package platforms

import (
	"bytes"
	"context"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"testing"
	"time"
)

func basicOf(platform string) string {
	return basicAuthorization(App{ClientID: "client-" + platform, ClientSecret: "app-secret-" + platform})
}

func TestXSignInRenewalAndRevokeAreTheRequestsXDocuments(t *testing.T) {
	address, _ := url.Parse(withApps(fake()).AuthorizeURL("x", redirect, "the-state", "the-challenge"))
	check(t, "consent screen", address.Scheme+"://"+address.Host+address.Path, "https://x.com/i/oauth2/authorize")
	check(t, "its query", address.Query(), url.Values{"response_type": {"code"}, "client_id": {"client-x"}, "redirect_uri": {redirect},
		"scope": {"tweet.read tweet.write users.read offline.access media.write"}, "state": {"the-state"}, "code_challenge": {"the-challenge"}, "code_challenge_method": {"S256"}})
	platform := fake(reply(200, `{"token_type":"bearer","expires_in":7200,"access_token":"x-access","refresh_token":"x-refresh","scope":"tweet.read tweet.write users.read offline.access media.write"}`),
		reply(200, `{"data":{"id":"1234567890","name":"Ansa Bakery","username":"ansabakery"}}`))
	accounts, failure := withApps(platform).Authorize(context.Background(), "x", redirect, "the-code", "the-verifier")
	exchange, me := platform.requests[0], platform.requests[1]
	check(t, "exchange", []string{exchange.method, exchange.address, exchange.header.Get("Authorization"), exchange.header.Get("Content-Type")},
		[]string{"POST", "https://api.x.com/2/oauth2/token", basicOf("x"), "application/x-www-form-urlencoded"})
	check(t, "its form (no client_id)", formOf(exchange.body), url.Values{"code": {"the-code"}, "grant_type": {"authorization_code"}, "redirect_uri": {redirect}, "code_verifier": {"the-verifier"}})
	check(t, "users/me", []string{me.method, me.address, me.header.Get("Authorization")}, []string{"GET", "https://api.x.com/2/users/me", "Bearer x-access"})
	if failure != "" || len(accounts) != 1 || !accounts[0].AccessExpiresAt.Equal(testNow.Add(7200*time.Second)) {
		t.Fatalf("authorized: %q %+v", failure, accounts)
	}
	check(t, "the account", []string{accounts[0].ExternalID, accounts[0].DisplayName, accounts[0].Kind, accounts[0].RefreshToken},
		[]string{"1234567890", "Ansa Bakery (@ansabakery)", "account", "x-refresh"})
	rotating := fake(reply(200, `{"token_type":"bearer","expires_in":7200,"access_token":"new-access","refresh_token":"new-refresh"}`), reply(200, `{"expires_in":7200,"access_token":"newer-access"}`))
	renewed := withApps(rotating).Renew(context.Background(), "x", "old-refresh")
	check(t, "renewed", []any{renewed.Kind, renewed.AccessToken, renewed.RefreshToken, renewed.AccessExpiresAt.Equal(testNow.Add(2 * time.Hour)), renewed.RefreshExpiresAt == nil},
		[]any{"refreshed", "new-access", "new-refresh", true, true})
	check(t, "renewal form", formOf(rotating.requests[0].body), url.Values{"refresh_token": {"old-refresh"}, "grant_type": {"refresh_token"}})
	check(t, "renewal auth", rotating.requests[0].header.Get("Authorization"), basicOf("x"))
	check(t, "no new refresh token: the old one kept", withApps(rotating).Renew(context.Background(), "x", "old-refresh").RefreshToken, "old-refresh")
	check(t, "refused", withApps(fake(reply(400, `{"error":"invalid_request"}`))).Renew(context.Background(), "x", "r").Kind, "refused")
	check(t, "no clear answer", withApps(fake(reply(503, ""))).Renew(context.Background(), "x", "r").Kind, "unavailable")
	revoking := fake(reply(200, `{"revoked":true}`), reply(200, `{"revoked":true}`))
	check(t, "revoked", withApps(revoking).Revoke(context.Background(), "x", "the-access", "the-refresh"), "revoked")
	check(t, "the refresh token first", []any{formOf(revoking.requests[0].body), formOf(revoking.requests[1].body), revoking.requests[1].address, revoking.requests[1].header.Get("Authorization")},
		[]any{url.Values{"token": {"the-refresh"}}, url.Values{"token": {"the-access"}}, "https://api.x.com/2/oauth2/revoke", basicOf("x")})
	check(t, "a failed revoke", withApps(fake(reply(503, "no"))).Revoke(context.Background(), "x", "a", "r"), "status_503")
}

func TestXPostsArePostTweetsWithAnImageUploadedFirst(t *testing.T) {
	target := Target{ExternalID: "1234567890", Token: "user-token"}
	text := fake(reply(201, `{"data":{"id":"1460323737035677698","text":"Hi"}}`))
	check(t, "published", withApps(text).Publish(context.Background(), "x", false, target, Post{Text: "Fresh bread #sourdough"}),
		PostResult{Kind: "published", PostID: "1460323737035677698", URL: "https://x.com/i/web/status/1460323737035677698"})
	check(t, "post request", []string{text.requests[0].method, text.requests[0].address, string(text.requests[0].body)},
		[]string{"POST", "https://api.x.com/2/tweets", `{"text":"Fresh bread #sourdough"}`})
	headersAre(t, text.requests[0], map[string]string{"Authorization": "Bearer user-token", "Content-Type": "application/json"})
	image := fake(reply(200, `{"data":{"id":"1146654567674912769","media_key":"3_1146654567674912769","size":100}}`), reply(201, `{"data":{"id":"1460323737035677699"}}`))
	if result := withApps(image).Publish(context.Background(), "x", false, target, imagePost("Look")); result.Kind != "published" {
		t.Fatalf("image post: %+v", result)
	}
	upload, tweet := image.requests[0], image.requests[1]
	check(t, "upload", []string{upload.method, upload.address, upload.header.Get("Authorization")}, []string{"POST", "https://api.x.com/2/media/upload", "Bearer user-token"})
	fields := multipartFields(t, upload)
	check(t, "upload form", []string{fields["media_category"], fields["media"], fields["media type"]}, []string{"tweet_image", string(pngBytes), "image/png"})
	check(t, "tweet with its image", string(tweet.body), `{"text":"Look","media":{"media_ids":["1146654567674912769"]}}`)
	everyRequestHadATimeLimit(t, image)
	resetIn90 := strconv.FormatInt(testNow.Unix()+90, 10)
	cases := []struct {
		answer func(*http.Request) (*http.Response, error)
		want   PostResult
	}{
		{reply(429, `{"title":"Too Many Requests"}`, "X-Rate-Limit-Reset", resetIn90), notCreated("rate_limited", 90)},
		{reply(400, `{}`), notCreated("invalid_request", 0)},
		{reply(401, `{}`), notCreated("token_rejected", 0)},
		{reply(403, `{"detail":"This user is not allowed to post a video longer than 2 minutes."}`), notCreated("permission_denied", 0)},
		{reply(404, `{}`), notCreated("not_found", 0)},
		{reply(503, `{}`), unclear("server_error")},
		{reply(500, `{}`), unclear("server_error")},
		{reply(200, `{"errors":[{"message":"partial"}]}`), unclear("no_post_id")},
		{unreachable, unclear("network_error")},
	}
	for _, each := range cases {
		check(t, "answer", withApps(fake(each.answer)).Publish(context.Background(), "x", false, target, Post{Text: "Hi"}), each.want)
	}
	// A refused upload posts nothing.
	refusedUpload := fake(reply(400, `{}`))
	check(t, "refused upload", withApps(refusedUpload).Publish(context.Background(), "x", false, target, imagePost("Hi")), notCreated("upload_failed", 0))
	check(t, "no post asked", refusedUpload.count(), 1)
	tooBig := Post{Text: "Hi", Media: &Media{Kind: "image", ContentType: "image/png", Bytes: make([]byte, xMaxImageBytes+1)}}
	check(t, "over 5 MB", withApps(fake()).Publish(context.Background(), "x", false, target, tooBig), notCreated("media_too_large", 0))
}

// multipartFields reads an upload's parts: each field's value, and the
// media part's own type as "media type".
func multipartFields(t *testing.T, request recorded) map[string]string {
	t.Helper()
	_, params, err := mime.ParseMediaType(request.header.Get("Content-Type"))
	if err != nil {
		t.Fatalf("multipart type: %v", err)
	}
	fields := map[string]string{}
	reader := multipart.NewReader(bytes.NewReader(request.body), params["boundary"])
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			return fields
		}
		if err != nil {
			t.Fatalf("multipart: %v", err)
		}
		value, _ := io.ReadAll(part)
		fields[part.FormName()] = string(value)
		if part.FormName() == "media" {
			fields["media type"] = part.Header.Get("Content-Type")
		}
	}
}
