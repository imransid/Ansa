// Package autopost is "Post for me" (the old lib/autopost/, services/autopost*.ts,
// db/autopost.ts): ansa plans, writes and posts on the business's Facebook
// Page by itself, and the owner never gives it a topic. ansa's own topic
// brain (this file, pure) picks what to post about; the Python brain only
// writes the post; ansa's checks read it; the publishing queue sends it.
package autopost

// The kinds of posts.
const (
	KindSpotlight       = "spotlight"
	KindBehindTheScenes = "behind_the_scenes"
	KindQuestion        = "question"
	KindVisitUs         = "visit_us"
	KindTip             = "tip"
	KindSpecialDay      = "special_day"
)

// KindLabels are the words the AI and the page read for each kind.
var KindLabels = map[string]string{
	KindSpotlight:       "Something you offer",
	KindBehindTheScenes: "Behind the scenes",
	KindQuestion:        "A question for followers",
	KindVisitUs:         "Come and see us",
	KindTip:             "A useful tip",
	KindSpecialDay:      "A special day",
}

// weightedKind is one kind and how often it comes up, before what people
// liked changes it. A list, not a map: the first of equal scores wins, as
// in the old code's order.
type weightedKind struct {
	kind   string
	weight float64
}

var foodMix = []weightedKind{{KindSpotlight, 4}, {KindBehindTheScenes, 2}, {KindQuestion, 2}, {KindVisitUs, 2}, {KindTip, 1}}
var otherMix = []weightedKind{{KindSpotlight, 3}, {KindTip, 3}, {KindBehindTheScenes, 2}, {KindQuestion, 1}, {KindVisitUs, 2}}

var foodTypes = map[string]bool{"restaurant": true, "cafe": true, "bakery": true, "takeaway": true, "food_truck": true, "bar": true, "catering": true}

// specialDays most businesses post about, by "MM-DD". A short fixed list:
// days whose dates move (Easter, Ramadan) aren't in it.
var specialDays = map[string]string{
	"01-01": "New Year's Day", "02-14": "Valentine's Day", "03-08": "International Women's Day",
	"10-31": "Halloween", "12-24": "Christmas Eve", "12-25": "Christmas Day", "12-31": "New Year's Eve",
}

// PastPost is one earlier post, newest first in a history.
type PastPost struct {
	Kind string
	// The dish, product or service it was about ("" for none).
	ItemName, SpecialDay string
	// Reactions + comments + shares, or nil when no numbers were read yet.
	Engagement *float64
}

// BrainInput is what the choice reads.
type BrainInput struct {
	BusinessType string
	// What the business offers today, by name, in the menu's order.
	Items []string
	// The local date of the post ("2026-12-24") and its weekday ("Friday").
	Date, Weekday string
	History       []PastPost
	// Kinds to leave out this time (one that just failed ansa's checks).
	Skip []string
}

// Choice is what to post about.
type Choice struct {
	Kind, ItemName, SpecialDay, Topic string
}

// ChooseNextPost picks the next post: a special day on its date (once),
// else the kind with the best score, a spotlight on the item spotlighted
// least recently.
func ChooseNextPost(in BrainInput) Choice {
	if day := SpecialDayOn(in.Date); day != "" && !skipped(in.Skip, KindSpecialDay) && !alreadyPosted(in.History, day) {
		return Choice{Kind: KindSpecialDay, SpecialDay: day, Topic: day}
	}
	kind := pickKind(in)
	item := ""
	if kind == KindSpotlight {
		item = leastRecentItem(in.Items, in.History)
	}
	return Choice{Kind: kind, ItemName: item, Topic: topicFor(kind, item, in.Weekday)}
}

// pickKind: each kind's share of the mix, times how well its posts did
// compared with all posts (0.5 to 2), times 1.5 for "come and see us" on
// Thursday and Friday (the weekend sells), lowered for each of the last 3
// posts it was already used in.
func pickKind(in BrainInput) string {
	mix := otherMix
	if foodTypes[in.BusinessType] {
		mix = foodMix
	}
	average := averageEngagement(in.History)
	best, bestScore := "", -1.0
	for _, entry := range mix {
		if skipped(in.Skip, entry.kind) || (entry.kind == KindSpotlight && len(in.Items) == 0) {
			continue
		}
		recentUses := 0
		var ofKind []PastPost
		for index, post := range in.History {
			if post.Kind == entry.kind {
				ofKind = append(ofKind, post)
				if index < 3 {
					recentUses++
				}
			}
		}
		liked := 1.0
		if kindAverage := averageEngagement(ofKind); average != nil && *average != 0 && kindAverage != nil {
			liked = min(max(*kindAverage / *average, 0.5), 2)
		}
		timing := 1.0
		if entry.kind == KindVisitUs && weekendComing(in.Weekday) {
			timing = 1.5
		}
		score := entry.weight * liked * timing / float64(1+recentUses*2)
		if score > bestScore {
			best, bestScore = entry.kind, score
		}
	}
	if best == "" {
		return KindTip
	}
	return best
}

// leastRecentItem is the item whose last spotlight is the oldest (never
// spotlighted first, in the menu's order).
func leastRecentItem(items []string, history []PastPost) string {
	best, bestAge := "", -1
	for _, item := range items {
		age := len(history) + 1_000_000
		for index, post := range history {
			if post.Kind == KindSpotlight && post.ItemName == item {
				age = index
				break
			}
		}
		if age > bestAge {
			best, bestAge = item, age
		}
	}
	return best
}

func topicFor(kind, item, weekday string) string {
	switch kind {
	case KindSpotlight:
		return item
	case KindVisitUs:
		if weekendComing(weekday) {
			return "The weekend is coming: come and see us"
		}
		return "Come and see us"
	case KindQuestion:
		return "A question for our followers"
	case KindBehindTheScenes:
		return "Behind the scenes"
	}
	return "A useful tip from us"
}

// SpecialDayOn is the special day on a "2026-12-24" date, or "".
func SpecialDayOn(date string) string {
	if len(date) != 10 {
		return ""
	}
	return specialDays[date[5:]]
}

func weekendComing(weekday string) bool {
	return weekday == "Thursday" || weekday == "Friday"
}

func skipped(skip []string, kind string) bool {
	for _, k := range skip {
		if k == kind {
			return true
		}
	}
	return false
}

func alreadyPosted(history []PastPost, day string) bool {
	for _, post := range history {
		if post.SpecialDay == day {
			return true
		}
	}
	return false
}

func averageEngagement(posts []PastPost) *float64 {
	sum, count := 0.0, 0
	for _, post := range posts {
		if post.Engagement != nil {
			sum += *post.Engagement
			count++
		}
	}
	if count == 0 {
		return nil
	}
	average := sum / float64(count)
	return &average
}
