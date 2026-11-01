package analytics

import (
	"context"
	"strconv"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// The Analytics page (the old services/analytics-page.ts): the period's
// posts that went out with their newest numbers, the totals per platform,
// the period's publishing problems, when numbers were last read, the
// newest performance review and what each number means. Everyone in the
// company reads it; only owners ask for a review.

const (
	// The posts the totals are made of: more than a company can publish in
	// 90 days (30 tries a day), so every post of a period counts.
	postsReadMax = 3_000
	// The posts the page lists, newest first, and the problems.
	postsShown    = 200
	problemsShown = 50
	// A review needs at least this many posts with numbers in its period,
	// and reads at most the newest reviewPostsMax.
	minPostsForReview = 5
	reviewPostsMax    = 100
	// The period when the address names none, or an odd one.
	defaultPeriod = "30"
)

// Bounds are the moments a period runs between: the posts published from
// Days days ago until now.
type Bounds struct {
	Days       int
	Start, End time.Time
}

// ParsePeriod reads ?period=: "7", "30" or "90"; anything else (none,
// several, another number) is 30.
func ParsePeriod(values []string) string {
	if len(values) == 1 && (values[0] == "7" || values[0] == "30" || values[0] == "90") {
		return values[0]
	}
	return defaultPeriod
}

// periodBounds: in milliseconds, as the old Dates were, so a stored
// review's period and its ISO texts agree.
func periodBounds(period string, now time.Time) Bounds {
	days, _ := strconv.Atoi(period)
	end := now.Truncate(time.Millisecond)
	return Bounds{Days: days, Start: end.Add(-time.Duration(days) * 24 * time.Hour), End: end}
}

// ShownPost is a listed post: whether its numbers are still read, and in
// words why it has none (WhyNoNumbers, only without numbers) or why the
// latest try read nothing (LatestTryProblem, only under older numbers).
type ShownPost struct {
	PublishedPost
	NumbersStillRead bool   `json:"numbersStillRead"`
	WhyNoNumbers     string `json:"whyNoNumbers"`
	LatestTryProblem string `json:"latestTryProblem"`
}

// Page is what the Analytics page shows. Posts are the newest of the
// period (at most 200), PostCount all of them.
type Page struct {
	Period               string           `json:"period"`
	PeriodStart          time.Time        `json:"periodStart"`
	PeriodEnd            time.Time        `json:"periodEnd"`
	Posts                []ShownPost      `json:"posts"`
	PostCount            int              `json:"postCount"`
	PostsWithNumbers     int              `json:"postsWithNumbers"`
	Totals               []PlatformTotals `json:"totals"`
	Problems             []ProblemPost    `json:"problems"`
	Activity             MetricsActivity  `json:"activity"`
	Review               *ShownReview     `json:"review"`
	PostsNeededForReview int              `json:"postsNeededForReview"`
	// Why a review can't be made yet ("" when it can).
	PostsNeededText string `json:"postsNeededText"`
	CanReview       bool   `json:"canReview"`
	// How many days each platform's numbers are read, and what each number means.
	ReadDays    map[string]int        `json:"readDays"`
	Definitions []PlatformDefinitions `json:"definitions"`
}

// ReadPage reads one company's Analytics page for a period.
func ReadPage(ctx context.Context, pool *database.Pool, company tenant.CompanyID, isOwner bool, period string, now time.Time) (Page, error) {
	bounds := periodBounds(period, now)
	posts, err := publishedPosts(ctx, pool, company, bounds.Start, bounds.End, postsReadMax, false)
	if err != nil {
		return Page{}, err
	}
	page := Page{Period: period, PeriodStart: bounds.Start, PeriodEnd: bounds.End, PostCount: len(posts), Posts: []ShownPost{},
		Totals: TotalsByPlatform(posts), CanReview: isOwner, ReadDays: readDaysOfPlatforms(), Definitions: definitionsForPage()}
	if page.Problems, err = publishingProblems(ctx, pool, company, bounds.Start, bounds.End, problemsShown); err != nil {
		return Page{}, err
	}
	if page.Activity, err = metricsActivity(ctx, pool, company); err != nil {
		return Page{}, err
	}
	if page.Review, err = newestReview(ctx, pool, company); err != nil {
		return Page{}, err
	}
	for index, post := range posts {
		if post.Latest != nil {
			page.PostsWithNumbers++
		}
		if index < postsShown {
			page.Posts = append(page.Posts, toShownPost(post, now))
		}
	}
	page.PostsNeededForReview = postsStillNeeded(page.PostsWithNumbers)
	if page.PostsNeededForReview > 0 {
		page.PostsNeededText = describePostsStillNeeded(page.PostsWithNumbers)
	}
	return page, nil
}

func toShownPost(post PublishedPost, now time.Time) ShownPost {
	shown := ShownPost{PublishedPost: post, NumbersStillRead: NumbersStillRead(post.Platform, post.PublishedAt, now)}
	if post.Latest == nil {
		shown.WhyNoNumbers = WhyNoNumbers(shown)
	} else {
		shown.LatestTryProblem = LatestTryProblem(shown)
	}
	return shown
}

// postsStillNeeded is how many more posts with numbers a review needs (0: none).
func postsStillNeeded(postsWithNumbers int) int {
	return max(0, minPostsForReview-postsWithNumbers)
}

// describePostsStillNeeded: "A review needs at least 5 posts with numbers
// in the period, and it has 3: 2 more are needed."
func describePostsStillNeeded(postsWithNumbers int) string {
	needed := postsStillNeeded(postsWithNumbers)
	verb := "are"
	if needed == 1 {
		verb = "is"
	}
	return "A review needs at least " + strconv.Itoa(minPostsForReview) + " posts with numbers in the period, and it has " +
		strconv.Itoa(postsWithNumbers) + ": " + strconv.Itoa(needed) + " more " + verb + " needed."
}

// PlatformDefinitions are one platform's numbers, in the columns' order.
type PlatformDefinitions struct {
	Platform string             `json:"platform"`
	Label    string             `json:"label"`
	Metrics  []ColumnDefinition `json:"metrics"`
}

// ColumnDefinition is one column with what the platform means by it.
type ColumnDefinition struct {
	Column      string `json:"column"`
	ColumnLabel string `json:"columnLabel"`
	Definition
}

func definitionsForPage() []PlatformDefinitions {
	var all []PlatformDefinitions
	for _, platform := range Platforms {
		entry := PlatformDefinitions{Platform: platform, Label: PlatformLabels[platform]}
		for _, column := range MetricColumns {
			entry.Metrics = append(entry.Metrics, ColumnDefinition{Column: column, ColumnLabel: MetricLabels[column], Definition: Definitions[platform][column]})
		}
		all = append(all, entry)
	}
	return all
}

func readDaysOfPlatforms() map[string]int {
	days := map[string]int{}
	for _, platform := range Platforms {
		days[platform] = ReadDays(platform)
	}
	return days
}
