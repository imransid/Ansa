// Package analytics is the Co-Founder's Analytics page (the old
// services/analytics-page.ts, lib/analytics/, lib/metric-definitions.ts):
// what each post number means on each platform, the period's posts with
// their newest numbers, the totals per platform and the publishing
// problems; "Review performance" (the old services/performance-review.ts,
// lib/performance-review/), whose every cited number this code checks; and
// the development stand-in's simulated numbers (the old
// services/post-metrics-simulation.ts). Reading the numbers from the
// platforms is core/internal/postmetrics.
package analytics

import "time"

// Platforms ansa posts to, in the order the pages list them.
var Platforms = []string{"linkedin", "facebook", "x", "youtube"}

// PlatformLabels are the platforms' own names.
var PlatformLabels = map[string]string{"linkedin": "LinkedIn", "facebook": "Facebook", "x": "X", "youtube": "YouTube"}

// FormatLabels name a draft's format ("post" is a text post).
var FormatLabels = map[string]string{"post": "Text post", "image_post": "Post with an image", "video": "Video"}

// MetricColumns are the numbers ansa keeps about a post, one post_metrics
// column each, in the order every page and prompt lists them.
var MetricColumns = []string{"views", "reach", "reactions", "comments", "shares", "clicks", "video_views"}

// MetricLabels are our own names of the columns, where platforms are put side by side.
var MetricLabels = map[string]string{
	"views": "Views", "reach": "Reach", "reactions": "Reactions", "comments": "Comments",
	"shares": "Shares", "clicks": "Clicks", "video_views": "Video views",
}

// MetricValueMax is Postgres's integer: a number past it is not one ansa can keep.
const MetricValueMax = 2_147_483_647

// How many days after it went out a post's numbers are read. X's for
// fewer: X gives link clicks only for a post's first 30 days, and a read
// without them would hide the ones read before (the page and the review
// show each post's newest snapshot).
const (
	metricsReadDays  = 30
	xMetricsReadDays = 28
)

// Definition is what one platform means by one of our columns. collected:
// ansa reads it from the platform's Field. needs_permission: the platform
// gives it only to apps with Permission, which ansa doesn't ask for, so it
// stays empty. not_offered: the platform has no such number for the posts
// ansa publishes there. Label is the platform's own word.
type Definition struct {
	Status     string `json:"status"`
	Label      string `json:"label,omitempty"`
	Field      string `json:"field,omitempty"`
	Definition string `json:"definition"`
	Permission string `json:"permission,omitempty"`
}

func collected(label, field, definition string) Definition {
	return Definition{Status: "collected", Label: label, Field: field, Definition: definition}
}

func needsPermission(permission, label, field, definition string) Definition {
	return Definition{Status: "needs_permission", Label: label, Field: field, Definition: definition, Permission: permission}
}

func notOffered(definition string) Definition {
	return Definition{Status: "not_offered", Definition: definition}
}

const (
	linkedInPermission = "r_member_postAnalytics (LinkedIn's Community Management API, an app of its own)"
	facebookPermission = "read_insights (and the Page's ANALYZE task)"
	youTubePermission  = "yt-analytics.readonly (the YouTube Analytics API)"
)

// Definitions: every field is one docs/research/social-publishing-apis.md
// names (section 5, checked 2026-10-28).
var Definitions = map[string]map[string]Definition{
	"linkedin": {
		"views":       needsPermission(linkedInPermission, "Impressions", "IMPRESSION", "How many times the post was shown."),
		"reach":       needsPermission(linkedInPermission, "Members reached", "MEMBERS_REACHED", "How many different members saw the post."),
		"reactions":   needsPermission(linkedInPermission, "Reactions", "REACTION", "Reactions of every kind."),
		"comments":    needsPermission(linkedInPermission, "Comments", "COMMENT", "Comments on the post."),
		"shares":      needsPermission(linkedInPermission, "Reposts", "RESHARE", "How many times members reposted it."),
		"clicks":      needsPermission(linkedInPermission, "Link clicks", "LINK_CLICKS", "Clicks on a link in the post."),
		"video_views": notOffered("ansa sends no videos to LinkedIn, and its member post numbers count no plays."),
	},
	"facebook": {
		"views":     needsPermission(facebookPermission, "Views", "post_media_view", "How often the post was on screen (Meta retired impressions in 2025-2026)."),
		"reach":     needsPermission(facebookPermission, "Viewers", "post_total_media_view_unique", "How many different people saw the post."),
		"reactions": collected("Reactions", "reactions.summary.total_count", "Reactions of every kind (like, love, ...)."),
		"comments":  collected("Comments", "comments.summary.total_count", "Comments on the post."),
		"shares": collected("Shares", "shares.count",
			"How many times the post was shared. Facebook may leave the number out until someone shares it: ansa then shows none, not 0."),
		"clicks":      needsPermission(facebookPermission, "Clicks", "post_clicks", "Clicks anywhere on the post."),
		"video_views": notOffered("ansa sends no videos to Facebook yet."),
	},
	"x": {
		"views":       collected("Impressions", "public_metrics.impression_count", "How many times the post was seen."),
		"reach":       notOffered("X gives no count of the different people who saw a post."),
		"reactions":   collected("Likes", "public_metrics.like_count", "Likes of the post."),
		"comments":    collected("Replies", "public_metrics.reply_count", "Replies to the post."),
		"shares":      collected("Reposts and quotes", "public_metrics.retweet_count + quote_count", "Reposts and quote posts together."),
		"clicks":      collected("Link clicks", "non_public_metrics.url_link_clicks", "Clicks on a link in the post. X gives them for posts of the last 30 days only."),
		"video_views": notOffered("ansa sends no videos to X yet."),
	},
	"youtube": {
		"views": collected("Views", "statistics.viewCount",
			"How many times the video was played (YouTube's live count; its Analytics numbers come 48-72 hours late)."),
		"reach":       notOffered("YouTube gives no count of the different people who watched one video."),
		"reactions":   collected("Likes", "statistics.likeCount", "Likes of the video."),
		"comments":    collected("Comments", "statistics.commentCount", "Comments on the video."),
		"shares":      needsPermission(youTubePermission, "Shares", "shares", "How many times the video was shared."),
		"clicks":      notOffered("YouTube gives no click count for a video."),
		"video_views": notOffered("Every view on YouTube is a video view: see Views."),
	},
}

// ReadDays is how many days after it went out ansa reads the numbers of a
// post on the platform.
func ReadDays(platform string) int {
	if platform == "x" {
		return xMetricsReadDays
	}
	return metricsReadDays
}

// NumbersStillRead: whether ansa still reads a post's numbers at now.
func NumbersStillRead(platform string, publishedAt, now time.Time) bool {
	return now.Sub(publishedAt) < time.Duration(ReadDays(platform))*24*time.Hour
}

// CollectedColumns are the columns ansa reads from a platform (none from LinkedIn).
func CollectedColumns(platform string) []string {
	var columns []string
	for _, column := range MetricColumns {
		if Definitions[platform][column].Status == "collected" {
			columns = append(columns, column)
		}
	}
	return columns
}

// PlatformOffers: whether the platform has such a number at all, collected
// or not (what a simulated snapshot may hold, standing in for the platform).
func PlatformOffers(platform, column string) bool {
	definition, known := Definitions[platform][column]
	return known && definition.Status != "not_offered"
}

// MetricLabel is what the platform calls one of our columns ("Impressions"
// on X), or our own name.
func MetricLabel(platform, column string) string {
	definition, known := Definitions[platform][column]
	if !known || definition.Status == "not_offered" {
		return MetricLabels[column]
	}
	return definition.Label
}
