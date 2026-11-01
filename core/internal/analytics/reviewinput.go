package analytics

import (
	"fmt"
	"math"
	"sort"
	"time"
	"unicode/utf16"
)

// What a performance review is made from, and what is stored as its
// input_summary (the old lib/performance-review/review-input.ts, the same
// JSON keys, so old and new rows read the same): exactly the numbers sent.
// Aggregates only: per post a label (P1, P2, ...), its platform, format,
// pillar, topic and when it went out (weekday and hour in the owner's time
// zone) with its newest numbers; per platform and per pillar a group (G1,
// G2, ...) with its totals. No post text beyond the topic, no account, no
// person, no customer data.

// Numbers are a post's or a group's numbers by key. A post has only the
// numbers its platform gave (a missing one is not 0). A group has "posts"
// and, per number, <metric>_total, <metric>_posts (how many posts have it)
// and <metric>_per_post (the total over those, to one decimal).
type Numbers map[string]float64

// ReviewPeriod: start and end as JavaScript's toISOString wrote them.
type ReviewPeriod struct {
	Days  int    `json:"days"`
	Start string `json:"start"`
	End   string `json:"end"`
}

// ReviewPost is one post with numbers.
type ReviewPost struct {
	Label     string  `json:"label"`
	Platform  string  `json:"platform"`
	Format    string  `json:"format"`
	Pillar    string  `json:"pillar"`
	Topic     string  `json:"topic"`
	Weekday   string  `json:"weekday"`
	Hour      string  `json:"hour"`
	Simulated bool    `json:"simulated"`
	Numbers   Numbers `json:"numbers"`
}

// ReviewGroup: Kind "platform" or "pillar" (by Name), or "no_pillar".
type ReviewGroup struct {
	Label   string  `json:"label"`
	Kind    string  `json:"kind"`
	Name    string  `json:"name"`
	Numbers Numbers `json:"numbers"`
}

// ReviewInput is one review's input. PostCount: every post of the period
// with numbers; PostsLeftOut: how many of them the request left out.
type ReviewInput struct {
	Period       ReviewPeriod  `json:"period"`
	TimeZone     string        `json:"timeZone"`
	PostCount    int           `json:"postCount"`
	PostsLeftOut int           `json:"postsLeftOut"`
	Simulated    bool          `json:"simulated"`
	Posts        []ReviewPost  `json:"posts"`
	Groups       []ReviewGroup `json:"groups"`
}

// isoTime is how JavaScript's toISOString writes a moment.
const isoTime = "2006-01-02T15:04:05.000Z"

// buildReviewInput makes one review's input from the period's posts with
// numbers (newest first, at most the ones that fit), labeled in the order
// they went out.
func buildReviewInput(posts []PublishedPost, postCount int, period Bounds, zone *time.Location) ReviewInput {
	inOrder := append([]PublishedPost(nil), posts...)
	sort.SliceStable(inOrder, func(i, j int) bool { return inOrder[i].PublishedAt.Before(inOrder[j].PublishedAt) })
	input := ReviewInput{
		Period:   ReviewPeriod{Days: period.Days, Start: period.Start.UTC().Format(isoTime), End: period.End.UTC().Format(isoTime)},
		TimeZone: zone.String(), PostCount: postCount, Posts: []ReviewPost{},
	}
	for index, post := range inOrder {
		reviewPost := toReviewPost(post, fmt.Sprintf("P%d", index+1), zone)
		input.Simulated = input.Simulated || reviewPost.Simulated
		input.Posts = append(input.Posts, reviewPost)
	}
	input.PostsLeftOut = max(0, postCount-len(input.Posts))
	input.Groups = buildGroups(input.Posts)
	return input
}

func toReviewPost(post PublishedPost, label string, zone *time.Location) ReviewPost {
	numbers := Numbers{}
	for _, column := range MetricColumns {
		if value := post.Latest.Values[column]; value != nil {
			numbers[column] = float64(*value)
		}
	}
	local := post.PublishedAt.In(zone)
	return ReviewPost{
		Label: label, Platform: post.Platform, Format: post.Format, Pillar: post.Pillar, Topic: post.Topic,
		// The hour it went out, as HH:00: the minute says nothing more.
		Weekday: local.Weekday().String(), Hour: fmt.Sprintf("%02d:00", local.Hour()),
		Simulated: post.Latest.Source == "dev_simulated", Numbers: numbers,
	}
}

// buildGroups: a group per platform (in the platforms' order), then per
// pillar (by name, in JavaScript's order) and the posts without one.
func buildGroups(posts []ReviewPost) []ReviewGroup {
	groups := []ReviewGroup{}
	for _, platform := range Platforms {
		if ofPlatform := postsWhere(posts, func(p ReviewPost) bool { return p.Platform == platform }); len(ofPlatform) > 0 {
			groups = append(groups, ReviewGroup{Kind: "platform", Name: PlatformLabels[platform], Numbers: groupNumbers(ofPlatform)})
		}
	}
	pillars := pillarNames(posts)
	for _, pillar := range pillars {
		groups = append(groups, ReviewGroup{Kind: "pillar", Name: pillar, Numbers: groupNumbers(postsWhere(posts, func(p ReviewPost) bool { return p.Pillar == pillar }))})
	}
	// Without any pillar, the platform groups already hold every post.
	if withoutPillar := postsWhere(posts, func(p ReviewPost) bool { return p.Pillar == "" }); len(withoutPillar) > 0 && len(pillars) > 0 {
		groups = append(groups, ReviewGroup{Kind: "no_pillar", Name: "", Numbers: groupNumbers(withoutPillar)})
	}
	for index := range groups {
		groups[index].Label = fmt.Sprintf("G%d", index+1)
	}
	return groups
}

// pillarNames are the posts' pillars, each once, sorted as JavaScript's
// sort() does (by UTF-16 code units), so the labels match the old code's.
func pillarNames(posts []ReviewPost) []string {
	seen := map[string]bool{}
	var names []string
	for _, post := range posts {
		if post.Pillar != "" && !seen[post.Pillar] {
			seen[post.Pillar] = true
			names = append(names, post.Pillar)
		}
	}
	sort.Slice(names, func(i, j int) bool { return lessInUTF16(names[i], names[j]) })
	return names
}

func lessInUTF16(a, b string) bool {
	first, second := utf16.Encode([]rune(a)), utf16.Encode([]rune(b))
	for index := 0; index < len(first) && index < len(second); index++ {
		if first[index] != second[index] {
			return first[index] < second[index]
		}
	}
	return len(first) < len(second)
}

func postsWhere(posts []ReviewPost, keep func(ReviewPost) bool) []ReviewPost {
	var kept []ReviewPost
	for _, post := range posts {
		if keep(post) {
			kept = append(kept, post)
		}
	}
	return kept
}

func groupNumbers(posts []ReviewPost) Numbers {
	numbers := Numbers{"posts": float64(len(posts))}
	for _, column := range MetricColumns {
		total, given := 0.0, 0
		for _, post := range posts {
			if value, has := post.Numbers[column]; has {
				total += value
				given++
			}
		}
		if given == 0 {
			continue
		}
		numbers[column+"_total"] = total
		numbers[column+"_posts"] = float64(given)
		// To one decimal, as the old Math.round(x * 10) / 10 (the same for numbers above 0).
		numbers[column+"_per_post"] = math.Round(total/float64(given)*10) / 10
	}
	return numbers
}

// numbersInInput is every number the input holds: a limit of the data may name only these.
func numbersInInput(input ReviewInput) []float64 {
	numbers := []float64{float64(input.Period.Days), float64(input.PostCount), float64(len(input.Posts)), float64(input.PostsLeftOut)}
	for _, post := range input.Posts {
		for _, value := range post.Numbers {
			numbers = append(numbers, value)
		}
	}
	for _, group := range input.Groups {
		for _, value := range group.Numbers {
			numbers = append(numbers, value)
		}
	}
	return numbers
}
