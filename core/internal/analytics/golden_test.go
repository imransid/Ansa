package analytics

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

// The posts brain/tests/golden/performance_review.json was made from, as
// the old TypeScript got them (newest first does not matter: they are
// sorted by when they went out, ties keeping this order).
func goldenPosts() []PublishedPost {
	at := func(moment string) time.Time { parsed, _ := time.Parse(time.RFC3339, moment); return parsed }
	source := func(simulated bool) string {
		if simulated {
			return "dev_simulated"
		}
		return "platform"
	}
	post := func(platform, format, pillar, topic, moment string, simulated bool, values map[string]int64) PublishedPost {
		return PublishedPost{Platform: platform, Format: format, Pillar: pillar, Topic: topic, PublishedAt: at(moment), Latest: snapshotOf(source(simulated), values)}
	}
	longTopic := strings.TrimSpace("Card 4111 1111 1111 1111 refund story 🙂 " + strings.Repeat("and more ", 40))
	return []PublishedPost{
		post("x", "post", "Lunch ideas", `Top 5 breads <b>"fresh"</b> & 'warm'`, "2026-10-05T03:30:00Z", true, map[string]int64{"views": 40, "reactions": 2, "shares": 0}),
		post("linkedin", "post", "", "Post 1", "2026-10-03T18:45:00Z", false, map[string]int64{"views": 100, "reactions": 4}),
		post("linkedin", "image_post", "Pillar 123-45-6789", longTopic, "2026-10-07T23:59:00Z", true, map[string]int64{"comments": 2}),
		post("youtube", "video", "Behind the oven", "Oven tour", "2026-10-07T23:59:00Z", false, map[string]int64{"views": 7, "reactions": 1, "comments": 3}),
		post("facebook", "post", "Behind the oven", "Ünïcödé “quotes”", "2026-10-10T12:00:00Z", false, map[string]int64{"reactions": 9, "comments": 1, "shares": 2}),
		post("linkedin", "post", "Ábc", "Sorting", "2026-10-11T08:00:00Z", false, map[string]int64{"views": 33, "reactions": 3}),
		post("linkedin", "post", "abc", "Sorting 2", "2026-10-12T08:00:00Z", false, map[string]int64{"views": 34}),
	}
}

// The input (stored as input_summary, and the brain's request) is the one
// the old TypeScript built from the same posts, word for word: labels,
// weekdays and hours in the owner's zone, groups in JavaScript's order,
// totals, counts and averages to one decimal.
func TestTheReviewInputIsTheOldOneWordForWord(t *testing.T) {
	kolkata, _ := time.LoadLocation("Asia/Kolkata")
	start, _ := time.Parse(time.RFC3339, "2026-10-02T10:20:30.123Z")
	end, _ := time.Parse(time.RFC3339, "2026-11-01T10:20:30.123Z")
	built, _ := json.Marshal(buildReviewInput(goldenPosts(), 9, Bounds{Days: 30, Start: start, End: end}, kolkata))
	old, err := os.ReadFile("testdata/review_input.json")
	if err != nil {
		t.Fatal(err)
	}
	var got, want map[string]any
	json.Unmarshal(built, &got)
	json.Unmarshal(old, &want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("built:\n%s\nthe old code's:\n%s", built, old)
	}
}
