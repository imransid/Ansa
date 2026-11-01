package platforms

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestTheStandInWritesThePostAsAFileAndRefusesWhatThePlatformWould(t *testing.T) {
	folder := t.TempDir()
	none := fake()
	standIns := &Connectors{Development: true, StandInDir: folder, Transport: none, Now: func() time.Time { return testNow }}
	check(t, "mode", []string{standIns.Mode("x"), standIns.Mode("youtube")}, []string{"stand-in", "stand-in"})
	result := standIns.Publish(context.Background(), "linkedin", true, Target{ExternalID: "dev:stand-in", Token: "dev-token"}, imagePost("Fresh bread"))
	if result.Kind != "published" || !strings.HasPrefix(result.PostID, "dev-") || result.URL != "" {
		t.Fatalf("published as a file: %+v", result)
	}
	files, _ := filepath.Glob(filepath.Join(folder, "linkedin", "2026-10-28T12-00-00.000Z-*.json"))
	if len(files) != 1 || !strings.HasSuffix(files[0], strings.TrimPrefix(result.PostID, "dev-")+".json") {
		t.Fatalf("one file: %v", files)
	}
	content, _ := os.ReadFile(files[0])
	var record map[string]any
	json.Unmarshal(content, &record)
	media, _ := record["media"].(map[string]any)
	check(t, "the record", []any{record["note"], record["platform"], record["account_id"], record["text"], media["kind"], media["content_type"], media["size_bytes"], media["alt_text"]},
		[]any{"Development stand-in: this post was NOT published anywhere.", "linkedin", "dev:stand-in", "Fresh bread", "image", "image/png", float64(len(pngBytes)), "Three loaves"})
	if strings.Contains(string(content), "fake image bytes") || strings.Contains(string(content), "dev-token") {
		t.Fatal("the file holds the image's bytes or the token")
	}
	check(t, "a YouTube text post", standIns.Publish(context.Background(), "youtube", true, Target{}, Post{Text: "Hi"}), notCreated("text_posts_not_supported", 0))
	linkedInVideo := Post{Text: "Hi", Media: &Media{Kind: "video", ContentType: "video/mp4", Bytes: mp4Bytes}}
	check(t, "a LinkedIn video", standIns.Publish(context.Background(), "linkedin", true, Target{}, linkedInVideo), notCreated("video_not_supported", 0))
	check(t, "nothing asked of a platform", none.count(), 0)
}

func TestProductionRefusesTheStandInAndAPlatformWithoutItsApp(t *testing.T) {
	none := fake()
	production := &Connectors{StandInDir: t.TempDir(), Transport: none}
	check(t, "mode", production.Mode("linkedin"), "not-set-up")
	check(t, "a stand-in account", production.Publish(context.Background(), "x", true, Target{}, Post{Text: "Hi"}), notCreated("stand_in_in_production", 0))
	check(t, "a real account", production.Publish(context.Background(), "x", false, Target{ExternalID: "1", Token: "t"}, Post{Text: "Hi"}), notCreated("not_set_up", 0))
	check(t, "revoke", production.Revoke(context.Background(), "x", "a", "r"), "not_offered")
	check(t, "half an app is no app", (&Connectors{Apps: map[string]App{"x": {ClientID: "id"}}}).Mode("x"), "not-set-up")
	check(t, "nothing asked", none.count(), 0)
}

func TestARequestHasATimeLimitFollowsNoRedirectAndReadsAtMostOneMegabyte(t *testing.T) {
	neverAnswers := fake(func(r *http.Request) (*http.Response, error) {
		<-r.Context().Done()
		return nil, r.Context().Err()
	})
	c := withApps(neverAnswers)
	began := time.Now()
	got := c.send(context.Background(), request{method: http.MethodPost, address: "https://api.x.com/2/tweets", timeout: 50 * time.Millisecond})
	if got.noAnswer != "timeout" || time.Since(began) > 2*time.Second {
		t.Fatalf("cut off as a timeout: %+v", got)
	}
	failing := c.send(context.Background(), request{method: http.MethodPost, address: "https://api.x.com/2/tweets", timeout: time.Second})
	check(t, "a fake with nothing left", failing.noAnswer, "network_error")
	redirected := fake(reply(302, "", "Location", "https://elsewhere.test/steal"))
	got = withApps(redirected).send(context.Background(), request{method: http.MethodGet, address: "https://api.x.com/2/users/me", timeout: time.Second})
	check(t, "the redirect is the answer, not followed", []int{got.status, redirected.count()}, []int{302, 1})
	huge := fake(reply(200, `{"access_token":"`+strings.Repeat("a", maxAnswerBytes)+`"}`))
	got = withApps(huge).send(context.Background(), request{method: http.MethodGet, address: "https://api.x.com/2/users/me", timeout: time.Second})
	var read map[string]any
	check(t, "over 1 MB is unreadable", []any{got.status, readJSON(got, &read)}, []any{200, false})
}
