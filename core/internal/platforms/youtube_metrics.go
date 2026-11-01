package platforms

import (
	"context"
)

// YouTube's numbers of one video (the old adapters/youtube-metrics.ts):
// the Data API's videos.list with part=statistics, YouTube's live counts,
// read with the youtube.readonly scope ansa already asks for (1 quota
// unit). Shares and watch time are in the YouTube Analytics API, which
// needs yt-analytics.readonly: ansa doesn't ask for it. NOT TESTED against
// YouTube.

const youTubeVideosAddress = "https://www.googleapis.com/youtube/v3/videos"

// readYouTubeNumbers reads one video's views, likes and comments.
func (c *Connectors) readYouTubeNumbers(ctx context.Context, target Target, videoID string) (Numbers, string) {
	if !youTubeVideoID.MatchString(videoID) {
		return Numbers{}, "invalid_request"
	}
	answered := c.send(ctx, bearerGet(youTubeVideosAddress+"?part=statistics&id="+videoID, target.Token))
	if !answered.answered() {
		return Numbers{}, answered.noAnswer
	}
	if !answered.ok() {
		// quotaExceeded: ansa's whole Google project used its day's units.
		if contains(youTubeReasons(answered), "quotaExceeded") {
			return Numbers{}, "quota_exceeded"
		}
		return Numbers{}, numbersFailureForStatus(answered.status)
	}
	var read struct {
		Items []struct {
			Statistics struct {
				Views    *string `json:"viewCount"`
				Likes    *string `json:"likeCount"`
				Comments *string `json:"commentCount"`
			} `json:"statistics"`
		} `json:"items"`
	}
	if !readJSON(answered, &read) || len(read.Items) > 5 {
		return Numbers{}, "unexpected_answer"
	}
	allRead := true
	numbersOf := func(text *string) *int64 {
		value, ok := countFromText(text)
		allRead = allRead && ok
		return value
	}
	var numbers []Numbers
	for _, item := range read.Items {
		numbers = append(numbers, Numbers{Views: numbersOf(item.Statistics.Views), Reactions: numbersOf(item.Statistics.Likes), Comments: numbersOf(item.Statistics.Comments)})
	}
	if !allRead {
		return Numbers{}, "unexpected_answer"
	}
	if len(numbers) == 0 {
		// An id YouTube doesn't know (deleted, or made private by its owner).
		return Numbers{}, "not_found"
	}
	return collectedOrNothing(numbers[0])
}
