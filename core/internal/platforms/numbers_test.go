package platforms

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

// shown writes numbers as "views=120 reach=- ..." (- = not given).
func shown(numbers Numbers) string {
	values := []*int64{numbers.Views, numbers.Reach, numbers.Reactions, numbers.Comments, numbers.Shares, numbers.Clicks, numbers.VideoViews}
	parts := []string{}
	for i, value := range values {
		text := "-"
		if value != nil {
			text = strconv.FormatInt(*value, 10)
		}
		parts = append(parts, MetricColumns[i]+"="+text)
	}
	return strings.Join(parts, " ")
}

// filled are the columns a reader filled.
func filled(numbers Numbers) []string {
	columns := []string{}
	for _, part := range strings.Split(shown(numbers), " ") {
		if !strings.HasSuffix(part, "=-") {
			columns = append(columns, strings.SplitN(part, "=", 2)[0])
		}
	}
	return columns
}

func numbersOf(platform, postID string, daysOld float64, answers ...func(*http.Request) (*http.Response, error)) (Numbers, string, *fakePlatform) {
	platformFake := fake(answers...)
	publishedAt := testNow.Add(-time.Duration(daysOld * float64(24*time.Hour)))
	numbers, failure := withApps(platformFake).ReadNumbers(context.Background(), platform, false, Target{ExternalID: "account-1", Token: "token-" + platform}, postID, publishedAt)
	return numbers, failure, platformFake
}

func xNumbersAnswer(fields string) func(*http.Request) (*http.Response, error) {
	return reply(200, `{"data":{"id":"1","public_metrics":{`+fields+`},"non_public_metrics":{"url_link_clicks":5}}}`)
}

func TestXNumbersAreOneReadOfThePostWithLinkClicksWhileYoung(t *testing.T) {
	young, failure, platform := numbersOf("x", "1790000000000000001", 1, xNumbersAnswer(`"impression_count":120,"like_count":8,"reply_count":0,"retweet_count":2,"quote_count":1,"bookmark_count":4`))
	request := platform.requests[0]
	check(t, "request", []any{request.method, request.address, request.header.Get("Authorization"), request.hadTimeLimit},
		[]any{"GET", "https://api.x.com/2/tweets/1790000000000000001?tweet.fields=public_metrics,non_public_metrics", "Bearer token-x", true})
	check(t, "numbers (a 0 stays 0)", []string{failure, shown(young)}, []string{"", "views=120 reach=- reactions=8 comments=0 shares=3 clicks=5 video_views=-"})
	check(t, "what X gives", filled(young), []string{"views", "reactions", "comments", "shares", "clicks"})
	old, _, platform := numbersOf("x", "1790000000000000002", 29.5, reply(200, `{"data":{"public_metrics":{"impression_count":900,"like_count":30,"reply_count":4,"retweet_count":6}}}`))
	check(t, "past 29 days: public numbers only", platform.requests[0].address, "https://api.x.com/2/tweets/1790000000000000002?tweet.fields=public_metrics")
	// No quote count: reposts alone would be a wrong total, so shares stay unknown.
	check(t, "old numbers", shown(old), "views=900 reach=- reactions=30 comments=4 shares=- clicks=- video_views=-")
}

func TestXNumbersRefusalsAndOddAnswers(t *testing.T) {
	for status, want := range map[int]string{401: "token_rejected", 403: "permission_denied", 404: "not_found", 429: "rate_limited", 503: "server_error", 400: "invalid_request"} {
		if _, failure, _ := numbersOf("x", "1790000000000000003", 1, reply(status, "")); failure != want {
			t.Fatalf("%d: %s", status, failure)
		}
	}
	if _, failure, _ := numbersOf("x", "1790000000000000003", 1, unreachable); failure != "network_error" {
		t.Fatalf("unreachable: %s", failure)
	}
	// A post deleted on X: the problem type as api.x.com writes it, and as api.twitter.com did.
	for _, host := range []string{"api.x.com", "api.twitter.com"} {
		notFound := reply(200, `{"errors":[{"title":"Not Found Error","detail":"Could not find tweet","type":"https://`+host+`/2/problems/resource-not-found"}]}`)
		if _, failure, _ := numbersOf("x", "1790000000000000003", 1, notFound); failure != "not_found" {
			t.Fatalf("%s: %s", host, failure)
		}
	}
	hidden := `{"errors":[{"title":"Authorization Error","type":"https://api.x.com/2/problems/not-authorized-for-resource"}]}`
	for _, body := range []string{hidden, `{}`, `{"errors":[{"title":"Not Found Error"}]}`} {
		if _, failure, _ := numbersOf("x", "1790000000000000003", 1, reply(200, body)); failure != "no_numbers" {
			t.Fatalf("%s: %s", body, failure)
		}
	}
	for _, odd := range []string{"-1", "2.5", fmt.Sprint(CountMax + 1), `"12"`} {
		if _, failure, _ := numbersOf("x", "1790000000000000003", 1, xNumbersAnswer(`"impression_count":`+odd+`,"like_count":1`)); failure != "unexpected_answer" {
			t.Fatalf("%s: %s", odd, failure)
		}
	}
	_, failure, platform := numbersOf("x", "../users/me", 1, xNumbersAnswer(`"like_count":1`))
	check(t, "an odd id asks nothing", []any{failure, platform.count()}, []any{"invalid_request", 0})
}

func TestYouTubeNumbersAreVideosListStatistics(t *testing.T) {
	read, failure, platform := numbersOf("youtube", "dQw4w9WgXcQ", 1, reply(200, `{"items":[{"id":"dQw4w9WgXcQ","statistics":{"viewCount":"1500","likeCount":"40","favoriteCount":"0","commentCount":"7"}}]}`))
	check(t, "request", []string{platform.requests[0].address, platform.requests[0].header.Get("Authorization")},
		[]string{"https://www.googleapis.com/youtube/v3/videos?part=statistics&id=dQw4w9WgXcQ", "Bearer token-youtube"})
	check(t, "numbers", []string{failure, shown(read)}, []string{"", "views=1500 reach=- reactions=40 comments=7 shares=- clicks=- video_views=-"})
	check(t, "what YouTube gives", filled(read), []string{"views", "reactions", "comments"})
	hidden, _, _ := numbersOf("youtube", "dQw4w9WgXcR", 1, reply(200, `{"items":[{"id":"dQw4w9WgXcR","statistics":{"viewCount":"12"}}]}`))
	check(t, "a count YouTube hides is none", shown(hidden), "views=12 reach=- reactions=- comments=- shares=- clicks=- video_views=-")
	quota := `{"error":{"errors":[{"reason":"quotaExceeded","message":"The request cannot be completed"}]}}`
	cases := map[string]func(*http.Request) (*http.Response, error){
		"not_found":         reply(200, `{"items":[]}`),
		"not_found ":        reply(404, ""),
		"quota_exceeded":    reply(403, quota),
		"token_rejected":    reply(401, ""),
		"unexpected_answer": reply(200, `{"items":[{"statistics":{"viewCount":"99999999999"}}]}`),
	}
	for want, answer := range cases {
		if _, failure, _ := numbersOf("youtube", "dQw4w9WgXcS", 1, answer); failure != strings.TrimSpace(want) {
			t.Fatalf("%s: %s", want, failure)
		}
	}
}

func TestLinkedInNumbersAreNeverAskedForAndTheStandInMakesNoneUp(t *testing.T) {
	_, failure, platform := numbersOf("linkedin", "urn:li:share:7000000000000000001", 1)
	check(t, "linkedin", []any{failure, platform.count()}, []any{"needs_permission", 0})
	standIn := fake()
	_, failure = withApps(standIn).ReadNumbers(context.Background(), "x", true, Target{}, "1", testNow)
	check(t, "stand-in", []any{failure, standIn.count()}, []any{"stand_in", 0})
	_, failure = (&Connectors{Transport: standIn, Development: true}).ReadNumbers(context.Background(), "x", false, Target{}, "1", testNow)
	check(t, "not set up", failure, "not_set_up")
}
