package calendar

import (
	"math"
	"regexp"
	"strings"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/profile"
	"ansa/core/internal/strategy"
)

// What "Plan the next 2 weeks" asks for and keeps (the old
// lib/calendar-plan/plan-prompt.ts planTargets and plan-answer.ts). Pure.

const (
	// The days planned, from tomorrow.
	planningDays = 14
	// The most ideas one plan adds, on all platforms together.
	plannedIdeasMax = 40
	// The longest topic a draft holds.
	topicMaxLength = 500
	defaultTime    = "09:00"
)

// Target is how many posts one platform of the cadence gets in the days
// planned, and the formats ansa can publish there.
type Target struct {
	Platform string   `json:"platform"`
	Posts    int      `json:"posts"`
	Formats  []string `json:"formats"`
}

// PlanTargets: each platform's posts a week for two weeks, rounded, at
// least one; never more than 40 in all (the busiest platform gives way first).
func PlanTargets(cadence []strategy.Cadence) []Target {
	targets := []Target{}
	total := 0
	for _, entry := range cadence {
		posts := max(1, int(math.Floor(entry.PostsPerWeek*planningDays/7+0.5)))
		targets = append(targets, Target{Platform: entry.Platform, Posts: posts, Formats: contentrules.PublishedFormats[entry.Platform]})
		total += posts
	}
	for total > plannedIdeasMax {
		busiest := 0
		for index := range targets {
			if targets[index].Posts > targets[busiest].Posts {
				busiest = index
			}
		}
		targets[busiest].Posts--
		total--
	}
	return targets
}

// Post is one idea as the brain proposed it, and as it is kept: its day
// and local time, platform and format, the plan's pillar and campaign
// ("" = none) and its topic.
type Post struct {
	Date     string `json:"date"`
	Time     string `json:"time"`
	Platform string `json:"platform"`
	Format   string `json:"format"`
	Pillar   string `json:"pillar"`
	Campaign string `json:"campaign"`
	Topic    string `json:"topic"`
}

// Asked is what the posts are kept to.
type Asked struct {
	Dates     []string
	Targets   []Target
	Pillars   []string
	Campaigns []string
	// Topics planned on those days already, as written.
	PlannedTopics []string
}

var clockPattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

// KeepPosts keeps the brain's posts to what was asked, post by post: a day
// not planned, a platform without a target and an empty topic drop, and so
// does a repeat (also of a topic planned already) or a post past its
// platform's target or the 40 in all. An odd time is 09:00, a format the
// platform doesn't take its first, a name the plan doesn't have none.
func KeepPosts(posts []Post, asked Asked) []Post {
	kept := []Post{}
	seen := map[string]bool{}
	for _, topic := range asked.PlannedTopics {
		seen[topicKey(topic)] = true
	}
	perPlatform := map[string]int{}
	for _, post := range posts {
		idea, target, ok := cleanPost(post, asked)
		if !ok || seen[topicKey(idea.Topic)] || perPlatform[idea.Platform] >= target.Posts || len(kept) >= plannedIdeasMax {
			continue
		}
		seen[topicKey(idea.Topic)] = true
		perPlatform[idea.Platform]++
		kept = append(kept, idea)
	}
	return kept
}

func cleanPost(post Post, asked Asked) (Post, Target, bool) {
	var target Target
	found := false
	for _, candidate := range asked.Targets {
		if candidate.Platform == post.Platform {
			target, found = candidate, true
		}
	}
	topic := profile.CutToLength(contentrules.CutRunsOfMarks(contentrules.CleanDraftLine(post.Topic)), topicMaxLength)
	if !found || !contains(asked.Dates, post.Date) || topic == "" || len(target.Formats) == 0 {
		return Post{}, target, false
	}
	idea := Post{Date: post.Date, Time: post.Time, Platform: post.Platform, Format: post.Format, Topic: topic,
		Pillar: planName(post.Pillar, asked.Pillars), Campaign: planName(post.Campaign, asked.Campaigns)}
	if !clockPattern.MatchString(idea.Time) {
		idea.Time = defaultTime
	}
	if !contains(target.Formats, idea.Format) {
		idea.Format = target.Formats[0]
	}
	return idea, target, true
}

// planName is the plan's own spelling of a name the brain gave, whatever
// its case; "" for one the plan doesn't have.
func planName(given string, names []string) string {
	wanted := strings.ToLower(strings.TrimSpace(given))
	for _, name := range names {
		if strings.ToLower(strings.TrimSpace(name)) == wanted {
			return name
		}
	}
	return ""
}

func topicKey(topic string) string {
	return strings.ToLower(strings.TrimSpace(topic))
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
