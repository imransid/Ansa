package publishing

import (
	"strings"
	"testing"
	"time"

	"ansa/core/internal/drafts"
)

// The checks read every platform's rules (contentrules.CheckDraft) with the
// draft's image or video and the confirmed words to avoid, as the old
// reviewDraft did: a blocking issue stops scheduling and sending.
func TestEveryPlatformsRulesBlockAPost(t *testing.T) {
	image := &attachedMedia{Kind: "image", AltText: "A loaf"}
	video := &attachedMedia{Kind: "video"}
	cases := []struct {
		name     string
		draft    drafts.Draft
		content  draftContent
		avoid    string
		blocking bool
	}{
		{"an X post within 280", drafts.Draft{Platform: "x", Format: "post", Body: "Hello"}, draftContent{}, "", false},
		{"an X post over 280", drafts.Draft{Platform: "x", Format: "post", Body: strings.Repeat("a", 281)}, draftContent{}, "", true},
		{"a LinkedIn post over 3,000", drafts.Draft{Platform: "linkedin", Format: "post", Body: strings.Repeat("a", 3001)}, draftContent{}, "", true},
		{"a Facebook post with no text", drafts.Draft{Platform: "facebook", Format: "post"}, draftContent{}, "", true},
		{"a post with an image, without it", drafts.Draft{Platform: "facebook", Format: "image_post", Body: "Hi"}, draftContent{}, "", true},
		{"a post with an image, with it", drafts.Draft{Platform: "facebook", Format: "image_post", Body: "Hi"}, draftContent{Media: image}, "", false},
		{"a post with an image, with a video", drafts.Draft{Platform: "facebook", Format: "image_post", Body: "Hi"}, draftContent{Media: video}, "", true},
		{"a YouTube video without a title", drafts.Draft{Platform: "youtube", Format: "video", Body: "About"}, draftContent{Media: video}, "", true},
		{"a YouTube video with its title", drafts.Draft{Platform: "youtube", Format: "video", Body: "About"}, draftContent{Media: video, Title: "Our kitchen"}, "", false},
		{"a word to avoid in the alt text", drafts.Draft{Platform: "x", Format: "image_post", Body: "Hi"}, draftContent{Media: image}, "loaf", true},
		{"a word to avoid in a video's script", drafts.Draft{Platform: "youtube", Format: "video", Body: "About"}, draftContent{Media: video, Title: "Kitchen", VideoScript: "Our cheap oven"}, "cheap", true},
		{"twelve hashtags", drafts.Draft{Platform: "facebook", Format: "post", Body: "Hi", Hashtags: strings.Split("a b c d e f g h i j k l", " ")}, draftContent{}, "", true},
	}
	for _, c := range cases {
		if _, blocked := forChecks(&c.draft, c.content, map[string]string{"words_to_avoid": c.avoid}); blocked != c.blocking {
			t.Errorf("%s: blocked %v", c.name, blocked)
		}
	}
}

// ansa schedules and sends only the formats it publishes to each platform
// (contentrules.PublishedFormats): text and image posts to LinkedIn,
// Facebook and X, videos to YouTube.
func TestOnlyTheFormatsAnsaPublishesAreScheduledOrSent(t *testing.T) {
	for pair, want := range map[[2]string]bool{
		{"linkedin", "image_post"}: true, {"x", "post"}: true, {"youtube", "video"}: true, {"facebook", "image_post"}: true,
		{"youtube", "post"}: false, {"facebook", "video"}: false, {"x", "video"}: false, {"mastodon", "post"}: false,
	} {
		if publishes(pair[0], pair[1]) != want {
			t.Errorf("%v: %v", pair, !want)
		}
	}
	video := Draft{Platform: "facebook", Format: "video", Status: "draft", Version: 1, ClaimsChecked: true}
	if _, refusal := DecideSchedule(ScheduleInput{ShownVersion: 1, WithoutApproval: true, Draft: video}); refusal != "format-not-published" {
		t.Fatalf("schedule: %s", refusal)
	}
	run := RunInput{ApprovalMode: "auto_rule", ApprovedVersion: 1, Draft: Draft{Platform: "facebook", Format: "video", Status: "scheduled", Version: 1}}
	if reason := ReasonNotToPublish(run); reason != "format_not_published" {
		t.Fatalf("run: %s", reason)
	}
}

// The old publishing-time-checks.ts: a post's address is kept only as
// https on its own platform's hosts, without a user name, a password or a
// port; a scheduled time is at most a minute ago and at most a year ahead.
func TestAPostsAddressAndAScheduledTime(t *testing.T) {
	kept := map[string][2]string{
		"https://www.linkedin.com/feed/update/urn:li:share:1/": {" https://www.linkedin.com/feed/update/urn:li:share:1/ ", "linkedin"},
		"https://x.com/ansa/status/1790000000000000001":        {"https://x.com/ansa/status/1790000000000000001", "x"},
		"https://youtu.be/abc123":                              {"https://youtu.be/abc123", "youtube"},
		"https://www.facebook.com/1_2":                         {"https://WWW.Facebook.com/1_2", "facebook"},
	}
	for stored, typed := range kept {
		if got := ReadPostURL(typed[0], typed[1]); got != stored {
			t.Errorf("%s: %q", typed[0], got)
		}
	}
	for _, refused := range [][2]string{
		{"http://www.linkedin.com/feed/update/1", "linkedin"}, {"https://www.linkedin.com.evil.test/feed", "linkedin"},
		{"https://x.com/ansa/status/1", "linkedin"}, {"https://user:secret@www.facebook.com/1", "facebook"},
		{"https://www.facebook.com:8443/1", "facebook"}, {"javascript:alert(1)", "x"}, {"not an address", "x"},
		{"https://x.com/" + strings.Repeat("a", 2_000), "x"}, {"", "x"},
	} {
		if got := ReadPostURL(refused[0], refused[1]); got != "" {
			t.Errorf("%.60s: kept as %q", refused[0], got)
		}
	}
	now := time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC)
	times := map[string]string{"2026-11-03T11:59:01Z": "ok", "2026-11-03T11:58:59Z": "past", "2027-11-03T12:00:00Z": "ok", "2027-11-03T12:00:01Z": "too_far"}
	for at, want := range times {
		instant, _ := time.Parse(time.RFC3339, at)
		if got := CheckScheduleTime(instant, now); got != want {
			t.Errorf("%s: %s", at, got)
		}
	}
}
