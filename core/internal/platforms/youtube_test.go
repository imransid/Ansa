package platforms

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

const bothYouTubeScopes = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly"

func youTubeConnects(channels string) *fakePlatform {
	return fake(reply(200, `{"access_token":"yt-access","expires_in":3599,"refresh_token":"yt-refresh","scope":"`+bothYouTubeScopes+`"}`), reply(200, channels))
}

func TestYouTubeSignInAndRenewalAreTheRequestsGoogleDocuments(t *testing.T) {
	address, _ := url.Parse(withApps(fake()).AuthorizeURL("youtube", redirect, "the-state", "the-challenge"))
	check(t, "consent screen", address.Scheme+"://"+address.Host+address.Path, "https://accounts.google.com/o/oauth2/v2/auth")
	check(t, "its query", address.Query(), url.Values{"client_id": {"client-youtube"}, "redirect_uri": {redirect}, "response_type": {"code"}, "scope": {bothYouTubeScopes},
		"access_type": {"offline"}, "prompt": {"consent"}, "state": {"the-state"}, "code_challenge": {"the-challenge"}, "code_challenge_method": {"S256"}})
	platform := youTubeConnects(`{"items":[{"id":"UCabcdefghijklmnopqrstuv","snippet":{"title":"Ansa Bakery TV"}}]}`)
	accounts, failure := withApps(platform).Authorize(context.Background(), "youtube", redirect, "the-code", "the-verifier")
	exchange, channels := platform.requests[0], platform.requests[1]
	check(t, "exchange", []string{exchange.method, exchange.address, exchange.header.Get("Content-Type")}, []string{"POST", "https://oauth2.googleapis.com/token", "application/x-www-form-urlencoded"})
	check(t, "its form", formOf(exchange.body), url.Values{"code": {"the-code"}, "client_id": {"client-youtube"}, "client_secret": {"app-secret-youtube"},
		"redirect_uri": {redirect}, "grant_type": {"authorization_code"}, "code_verifier": {"the-verifier"}})
	check(t, "channels.list", []string{channels.method, channels.address, channels.header.Get("Authorization")},
		[]string{"GET", "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", "Bearer yt-access"})
	if failure != "" || len(accounts) != 1 {
		t.Fatalf("authorized: %q", failure)
	}
	check(t, "the channel", []string{accounts[0].ExternalID, accounts[0].DisplayName, accounts[0].Kind, accounts[0].RefreshToken}, []string{"UCabcdefghijklmnopqrstuv", "Ansa Bakery TV", "channel", "yt-refresh"})
	if _, failure := withApps(youTubeConnects(`{"items":[]}`)).Authorize(context.Background(), "youtube", redirect, "c", "v"); failure != "no_channel" {
		t.Fatalf("no channel: %s", failure)
	}
	unticked := fake(reply(200, `{"access_token":"t","expires_in":3599,"scope":"https://www.googleapis.com/auth/youtube.readonly"}`))
	_, failure = withApps(unticked).Authorize(context.Background(), "youtube", redirect, "c", "v")
	check(t, "an unticked permission reads no channel", []any{failure, unticked.count()}, []any{"missing_permission", 1})
	renewing := fake(reply(200, `{"access_token":"fresh","expires_in":3599,"token_type":"Bearer"}`))
	renewed := withApps(renewing).Renew(context.Background(), "youtube", "the-refresh")
	check(t, "renewed", []any{renewed.Kind, renewed.AccessToken, renewed.RefreshToken, renewed.AccessExpiresAt.Equal(testNow.Add(3599 * time.Second)), renewed.RefreshExpiresAt == nil},
		[]any{"refreshed", "fresh", "the-refresh", true, true})
	check(t, "renewal form", formOf(renewing.requests[0].body), url.Values{"client_id": {"client-youtube"}, "client_secret": {"app-secret-youtube"}, "refresh_token": {"the-refresh"}, "grant_type": {"refresh_token"}})
	check(t, "invalid_grant", withApps(fake(reply(400, `{"error":"invalid_grant"}`))).Renew(context.Background(), "youtube", "r").Kind, "refused")
	check(t, "a 503", withApps(fake(reply(503, ""))).Renew(context.Background(), "youtube", "r").Kind, "unavailable")
	revoking := fake(reply(200, ""))
	check(t, "revoked", withApps(revoking).Revoke(context.Background(), "youtube", "the-access", "the-refresh"), "revoked")
	check(t, "the refresh token ends the grant", []any{revoking.requests[0].address, formOf(revoking.requests[0].body)},
		[]any{"https://oauth2.googleapis.com/revoke", url.Values{"token": {"the-refresh"}}})
}

const session = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=xa298sd_f&part=snippet,status"

func video(title string) Post {
	return Post{Text: "How we bake", Title: title, Media: &Media{Kind: "video", ContentType: "video/mp4", Bytes: mp4Bytes}}
}

func TestYouTubeVideosAreTheResumableVideosInsert(t *testing.T) {
	target := Target{ExternalID: "UCabcdefghijklmnopqrstuv", Token: "channel-token"}
	started := reply(200, "", "Location", session)
	platform := fake(started, reply(201, `{"id":"dQw4w9WgXcQ","snippet":{"title":"Our bakery"}}`))
	check(t, "published", withApps(platform).Publish(context.Background(), "youtube", false, target, video(" Our bakery ")),
		PostResult{Kind: "published", PostID: "dQw4w9WgXcQ", URL: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"})
	start, upload := platform.requests[0], platform.requests[1]
	check(t, "start", []string{start.method, start.address}, []string{"POST", "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status"})
	headersAre(t, start, map[string]string{"Authorization": "Bearer channel-token", "Content-Type": "application/json; charset=UTF-8",
		"X-Upload-Content-Length": strconv.Itoa(len(mp4Bytes)), "X-Upload-Content-Type": "video/mp4"})
	var details map[string]map[string]string
	json.Unmarshal(start.body, &details)
	check(t, "details", details, map[string]map[string]string{"snippet": {"title": "Our bakery", "description": "How we bake"}, "status": {"privacyStatus": "public"}})
	check(t, "upload", []string{upload.method, upload.address, string(upload.body)}, []string{"PUT", session, string(mp4Bytes)})
	headersAre(t, upload, map[string]string{"Authorization": "Bearer channel-token", "Content-Type": "video/mp4"})
	none := fake()
	check(t, "a text post", withApps(none).Publish(context.Background(), "youtube", false, target, Post{Text: "Hi", Title: "Hi"}), notCreated("text_posts_not_supported", 0))
	check(t, "no title", withApps(none).Publish(context.Background(), "youtube", false, target, video("  ")), notCreated("title_missing", 0))
	check(t, "nothing asked", none.count(), 0)
	googleError := func(status int, reason string) func(*http.Request) (*http.Response, error) {
		return reply(status, `{"error":{"code":`+strconv.Itoa(status)+`,"message":"quota","errors":[{"reason":"`+reason+`","domain":"youtube.quota"}]}}`)
	}
	cases := []struct {
		answers []func(*http.Request) (*http.Response, error)
		want    PostResult
	}{
		{[]func(*http.Request) (*http.Response, error){googleError(403, "quotaExceeded")}, notCreated("quota_exceeded", 0)},
		{[]func(*http.Request) (*http.Response, error){googleError(400, "uploadLimitExceeded")}, notCreated("quota_exceeded", 0)},
		{[]func(*http.Request) (*http.Response, error){googleError(403, "forbidden")}, notCreated("permission_denied", 0)},
		{[]func(*http.Request) (*http.Response, error){googleError(401, "authError")}, notCreated("token_rejected", 0)},
		{[]func(*http.Request) (*http.Response, error){reply(503, "")}, notCreated("upload_failed", 0)},
		{[]func(*http.Request) (*http.Response, error){reply(200, "", "Location", "https://uploads.evil.test/x")}, notCreated("upload_url_refused", 0)},
		{[]func(*http.Request) (*http.Response, error){started, reply(503, "")}, unclear("upload_interrupted")},
		{[]func(*http.Request) (*http.Response, error){started, unreachable}, unclear("upload_interrupted")},
		{[]func(*http.Request) (*http.Response, error){started, reply(404, "")}, notCreated("upload_session_expired", 0)},
		{[]func(*http.Request) (*http.Response, error){started, googleError(400, "invalidTitle")}, notCreated("invalid_request", 0)},
		{[]func(*http.Request) (*http.Response, error){started, reply(200, `{"kind":"youtube#video"}`)}, unclear("no_post_id")},
	}
	for _, each := range cases {
		platform := fake(each.answers...)
		check(t, "answer", withApps(platform).Publish(context.Background(), "youtube", false, target, video("Our bakery")), each.want)
		for _, request := range platform.requests {
			if strings.Contains(request.address, "evil") {
				t.Fatal("the channel's token went to another host")
			}
		}
	}
}
