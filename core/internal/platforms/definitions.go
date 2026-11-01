package platforms

// The numbers ansa keeps about a published post, one column each in
// post_metrics, and what each platform means by them (the old
// lib/metric-definitions.ts): which column it fills, from which of its
// fields, and one line the Analytics page shows. Every field here is one
// docs/research/social-publishing-apis.md names (section 5, checked
// 2026-10-28). A number a platform doesn't give is NULL, never 0.

// MetricColumns are post_metrics' number columns, in the pages' order.
var MetricColumns = []string{"views", "reach", "reactions", "comments", "shares", "clicks", "video_views"}

// MetricDefinition is what a platform means by one column. Status
// "collected": ansa reads it from Field. "needs_permission": the platform
// gives it only to apps with Permission, which ansa doesn't ask for, so it
// stays NULL. "not_offered": the platform gives no such number for the
// posts ansa publishes there. Label: the platform's word.
type MetricDefinition struct {
	Status, Label, Field, Definition, Permission string
}

func collected(label, field, definition string) MetricDefinition {
	return MetricDefinition{Status: "collected", Label: label, Field: field, Definition: definition}
}

func needsPermission(permission, label, field, definition string) MetricDefinition {
	return MetricDefinition{Status: "needs_permission", Label: label, Field: field, Definition: definition, Permission: permission}
}

func notOffered(definition string) MetricDefinition {
	return MetricDefinition{Status: "not_offered", Definition: definition}
}

const (
	linkedInAnalytics = "r_member_postAnalytics (LinkedIn's Community Management API, an app of its own)"
	facebookInsights  = "read_insights (and the Page's ANALYZE task)"
	youTubeAnalytics  = "yt-analytics.readonly (the YouTube Analytics API)"
)

// MetricDefinitions are every platform's seven numbers.
var MetricDefinitions = map[string]map[string]MetricDefinition{
	"linkedin": {
		"views":       needsPermission(linkedInAnalytics, "Impressions", "IMPRESSION", "How many times the post was shown."),
		"reach":       needsPermission(linkedInAnalytics, "Members reached", "MEMBERS_REACHED", "How many different members saw the post."),
		"reactions":   needsPermission(linkedInAnalytics, "Reactions", "REACTION", "Reactions of every kind."),
		"comments":    needsPermission(linkedInAnalytics, "Comments", "COMMENT", "Comments on the post."),
		"shares":      needsPermission(linkedInAnalytics, "Reposts", "RESHARE", "How many times members reposted it."),
		"clicks":      needsPermission(linkedInAnalytics, "Link clicks", "LINK_CLICKS", "Clicks on a link in the post."),
		"video_views": notOffered("ansa sends no videos to LinkedIn, and its member post numbers count no plays."),
	},
	"facebook": {
		"views":     needsPermission(facebookInsights, "Views", "post_media_view", "How often the post was on screen (Meta retired impressions in 2025-2026)."),
		"reach":     needsPermission(facebookInsights, "Viewers", "post_total_media_view_unique", "How many different people saw the post."),
		"reactions": collected("Reactions", "reactions.summary.total_count", "Reactions of every kind (like, love, ...)."),
		"comments":  collected("Comments", "comments.summary.total_count", "Comments on the post."),
		"shares": collected("Shares", "shares.count",
			"How many times the post was shared. Facebook may leave the number out until someone shares it: ansa then shows none, not 0."),
		"clicks":      needsPermission(facebookInsights, "Clicks", "post_clicks", "Clicks anywhere on the post."),
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
		"shares":      needsPermission(youTubeAnalytics, "Shares", "shares", "How many times the video was shared."),
		"clicks":      notOffered("YouTube gives no click count for a video."),
		"video_views": notOffered("Every view on YouTube is a video view: see Views."),
	},
}

// CollectedColumns are the columns ansa reads from a platform.
func CollectedColumns(platform string) []string {
	columns := []string{}
	for _, column := range MetricColumns {
		if MetricDefinitions[platform][column].Status == "collected" {
			columns = append(columns, column)
		}
	}
	return columns
}

// Offers says whether the platform has such a number at all, collected or
// not: what a simulated snapshot may hold, standing in for the platform.
func Offers(platform, column string) bool {
	definition, known := MetricDefinitions[platform][column]
	return known && definition.Status != "not_offered"
}
