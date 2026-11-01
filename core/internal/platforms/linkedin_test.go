package platforms

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func formOf(body []byte) url.Values {
	values, _ := url.ParseQuery(string(body))
	return values
}

func TestLinkedInSignInIsTheRequestsLinkedInDocuments(t *testing.T) {
	address, _ := url.Parse(withApps(fake()).AuthorizeURL("linkedin", redirect, "the-state", ""))
	check(t, "consent screen", address.Scheme+"://"+address.Host+address.Path, "https://www.linkedin.com/oauth/v2/authorization")
	check(t, "its query", address.Query(), url.Values{"response_type": {"code"}, "client_id": {"client-linkedin"}, "redirect_uri": {redirect}, "state": {"the-state"}, "scope": {"openid profile w_member_social"}})
	if !strings.Contains(address.RawQuery, "scope=openid%20profile%20w_member_social") || address.Query().Has("code_challenge") {
		t.Fatalf("spaces as %%20, no PKCE: %s", address.RawQuery)
	}
	platform := fake(reply(200, `{"access_token":"li-access","expires_in":5184000,"scope":"openid,profile,w_member_social"}`), reply(200, `{"sub":"abc123","name":"Ana\nBaker"}`))
	accounts, failure := withApps(platform).Authorize(context.Background(), "linkedin", redirect, "the-code", "")
	exchange, lookup := platform.requests[0], platform.requests[1]
	check(t, "exchange", []string{exchange.method, exchange.address, exchange.header.Get("Content-Type"), exchange.header.Get("Authorization")},
		[]string{"POST", "https://www.linkedin.com/oauth/v2/accessToken", "application/x-www-form-urlencoded", ""})
	check(t, "its form", formOf(exchange.body), url.Values{"grant_type": {"authorization_code"}, "code": {"the-code"}, "client_id": {"client-linkedin"}, "client_secret": {"app-secret-linkedin"}, "redirect_uri": {redirect}})
	check(t, "member lookup", []string{lookup.method, lookup.address, lookup.header.Get("Authorization")}, []string{"GET", "https://api.linkedin.com/v2/userinfo", "Bearer li-access"})
	everyRequestHadATimeLimit(t, platform)
	if failure != "" || len(accounts) != 1 {
		t.Fatalf("authorized: %q %d", failure, len(accounts))
	}
	account := accounts[0]
	check(t, "the account", []any{account.ExternalID, account.DisplayName, account.Kind, account.Scopes, account.AccessToken, account.RefreshToken, account.RefreshExpiresAt == nil},
		[]any{"abc123", "Ana Baker", "member", []string{"openid", "profile", "w_member_social"}, "li-access", "", true})
	if !account.AccessExpiresAt.Equal(testNow.Add(5184000 * time.Second)) {
		t.Fatalf("60 days from now: %v", account.AccessExpiresAt)
	}
	// LinkedIn refusing the code, a member id that isn't one, an unticked permission.
	cases := map[string]*fakePlatform{
		"exchange_failed":    fake(reply(401, `{"error":"invalid_request"}`)),
		"exchange_failed ":   fake(reply(200, `{"access_token":"t","expires_in":1}`), reply(200, `{"sub":"has spaces"}`)),
		"missing_permission": fake(reply(200, `{"access_token":"t","scope":"openid profile"}`), reply(200, `{"sub":"abc"}`)),
	}
	for want, platform := range cases {
		if _, failure := withApps(platform).Authorize(context.Background(), "linkedin", redirect, "c", ""); failure != strings.TrimSpace(want) {
			t.Fatalf("%s: %q", want, failure)
		}
	}
}

func TestLinkedInPostsAreThePostsAndImagesRequestsLinkedInDocuments(t *testing.T) {
	target := Target{ExternalID: "abc123", Token: "member-token"}
	restHeaders := map[string]string{"Authorization": "Bearer member-token", "Linkedin-Version": "202610", "X-Restli-Protocol-Version": "2.0.0", "Content-Type": "application/json"}
	text := fake(reply(201, "", "X-Restli-Id", "urn:li:share:7000000000000000001"))
	result := withApps(text).Publish(context.Background(), "linkedin", false, target, Post{Text: "Fresh bread (today) #sourdough"})
	check(t, "published", result, PostResult{Kind: "published", PostID: "urn:li:share:7000000000000000001", URL: "https://www.linkedin.com/feed/update/urn:li:share:7000000000000000001/"})
	post := text.requests[0]
	check(t, "post request", []string{post.method, post.address}, []string{"POST", "https://api.linkedin.com/rest/posts"})
	headersAre(t, post, restHeaders)
	var body map[string]any
	json.Unmarshal(post.body, &body)
	want := `{"author":"urn:li:person:abc123","commentary":"Fresh bread \\(today\\) {hashtag|\\#|sourdough}","distribution":{"feedDistribution":"MAIN_FEED","targetEntities":[],"thirdPartyDistributionChannels":[]},"isReshareDisabledByAuthor":false,"lifecycleState":"PUBLISHED","visibility":"PUBLIC"}`
	if encoded, _ := json.Marshal(body); string(encoded) != want {
		t.Fatalf("the post's body:\n%s", encoded)
	}
	upload := "https://www.linkedin.com/dms-uploads/C4E10AQ/uploaded-image/0?ca=vector_ads&cn=uploads"
	image := fake(reply(200, `{"value":{"uploadUrlExpiresAt":1650567510704,"uploadUrl":"`+upload+`","image":"urn:li:image:C4E10AQF"}}`), reply(201, ""),
		reply(201, "", "X-Restli-Id", "urn:li:ugcPost:7000000000000000002"))
	if result := withApps(image).Publish(context.Background(), "linkedin", false, target, imagePost("Look")); result.Kind != "published" {
		t.Fatalf("image post: %+v", result)
	}
	initialize, put, withImage := image.requests[0], image.requests[1], image.requests[2]
	check(t, "initialize", []string{initialize.method, initialize.address, string(initialize.body)},
		[]string{"POST", "https://api.linkedin.com/rest/images?action=initializeUpload", `{"initializeUploadRequest":{"owner":"urn:li:person:abc123"}}`})
	headersAre(t, initialize, restHeaders)
	check(t, "upload", []string{put.method, put.address, string(put.body)}, []string{"PUT", upload, string(pngBytes)})
	headersAre(t, put, map[string]string{"Authorization": "Bearer member-token", "Content-Type": "image/png"})
	if !strings.Contains(string(withImage.body), `"content":{"media":{"id":"urn:li:image:C4E10AQF","altText":"Three loaves"}}`) {
		t.Fatalf("the post names its image: %s", withImage.body)
	}
	everyRequestHadATimeLimit(t, image)
	check(t, "little text", LinkedInLittleText(`a_b *c* [d] {e} @f <g> ~h | \i #1 #ok C# #x_y`),
		`a\_b \*c\* \[d\] \{e\} \@f \<g\> \~h \| \\i \#1 {hashtag|\#|ok} C\# {hashtag|\#|x\_y}`)
}

// headersAre: exactly these headers, nothing else.
func headersAre(t *testing.T, request recorded, want map[string]string) {
	t.Helper()
	if len(request.header) != len(want) {
		t.Fatalf("headers of %s: %v", request.address, request.header)
	}
	for name, value := range want {
		if request.header.Get(name) != value {
			t.Fatalf("header %s of %s: %q", name, request.address, request.header.Get(name))
		}
	}
}

func TestLinkedInAnswersMapToWhatTheyMean(t *testing.T) {
	target := Target{ExternalID: "abc123", Token: "member-token"}
	cases := []struct {
		answer func(*http.Request) (*http.Response, error)
		want   PostResult
	}{
		{reply(422, `{"message":"Content is a duplicate of urn:li:share:123","status":422}`), notCreated("duplicate", 0)},
		{reply(422, `{"message":"Field value is invalid","status":422}`), notCreated("unprocessable", 0)},
		{reply(400, `{"status":400}`), notCreated("invalid_request", 0)},
		{reply(401, `{"status":401}`), notCreated("token_rejected", 0)},
		{reply(403, `{"status":403}`), notCreated("permission_denied", 0)},
		{reply(409, `{"status":409}`), notCreated("conflict", 0)},
		{reply(429, `{"status":429}`, "Retry-After", "120"), notCreated("rate_limited", 120)},
		{reply(500, `{"status":500}`), unclear("server_error")},
		{reply(503, `{"status":503}`), unclear("server_error")},
		{reply(201, ""), unclear("no_post_id")},
		{reply(302, "", "Location", "https://elsewhere.test/"), unclear("unexpected_answer")},
		{unreachable, unclear("network_error")},
	}
	for _, each := range cases {
		check(t, "answer", withApps(fake(each.answer)).Publish(context.Background(), "linkedin", false, target, Post{Text: "Hi"}), each.want)
	}
	elsewhere := fake(reply(200, `{"value":{"uploadUrl":"https://uploads.evil.test/put","image":"urn:li:image:X1"}}`))
	check(t, "upload elsewhere", withApps(elsewhere).Publish(context.Background(), "linkedin", false, target, imagePost("Hi")), notCreated("upload_url_refused", 0))
	check(t, "the token went nowhere else", elsewhere.count(), 1)
	none := fake()
	video := Post{Text: "Hi", Media: &Media{Kind: "video", ContentType: "video/mp4", Bytes: mp4Bytes}}
	check(t, "video", withApps(none).Publish(context.Background(), "linkedin", false, target, video), notCreated("video_not_supported", 0))
	webp := Post{Text: "Hi", Media: &Media{Kind: "image", ContentType: "image/webp", Bytes: pngBytes}}
	check(t, "webp", withApps(none).Publish(context.Background(), "linkedin", false, target, webp), notCreated("media_type_not_accepted", 0))
	check(t, "nothing asked", none.count(), 0)
	// A failed image step created nothing: no post is asked for.
	failedUpload := fake(reply(200, `{"value":{"uploadUrl":"https://www.linkedin.com/dms-uploads/x","image":"urn:li:image:X2"}}`), reply(500, ""))
	check(t, "failed upload", withApps(failedUpload).Publish(context.Background(), "linkedin", false, target, imagePost("Hi")), notCreated("upload_failed", 0))
	check(t, "no post asked", failedUpload.count(), 2)
}
