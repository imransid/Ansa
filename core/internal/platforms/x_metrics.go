package platforms

import (
	"context"
	"strings"
	"time"
)

// X's numbers of one post (the old adapters/x-metrics.ts; docs/research/
// social-publishing-apis.md, section 5): GET /2/tweets/<id> with
// tweet.fields public_metrics, and non_public_metrics (link clicks) while
// X still keeps them, with the account's own token (the post is its own).
// Every read is billed. NOT TESTED against X.

// X keeps the private numbers for posts of the last 30 days. A day less,
// so a post near the end isn't refused for them (X's clock and ours).
const xPrivateNumbersDays = 29

// X's problem type for a post it can't find, the same path whether it
// names api.x.com (its docs now) or api.twitter.com.
const xNotFoundProblem = "/2/problems/resource-not-found"

// xPostNumbers is the part of X's answer ansa reads.
type xPostNumbers struct {
	Public *struct {
		Impressions whole `json:"impression_count"`
		Likes       whole `json:"like_count"`
		Replies     whole `json:"reply_count"`
		Reposts     whole `json:"retweet_count"`
		Quotes      whole `json:"quote_count"`
	} `json:"public_metrics"`
	Private *struct {
		LinkClicks whole `json:"url_link_clicks"`
	} `json:"non_public_metrics"`
}

// readXNumbers reads impressions, likes, replies, reposts + quotes, and the
// link clicks while the post is young enough.
func (c *Connectors) readXNumbers(ctx context.Context, target Target, postID string, publishedAt time.Time) (Numbers, string) {
	if !xNumericID.MatchString(postID) {
		return Numbers{}, "invalid_request"
	}
	fields := "public_metrics"
	if c.now().Sub(publishedAt) < xPrivateNumbersDays*24*time.Hour {
		fields = "public_metrics,non_public_metrics"
	}
	answered := c.send(ctx, bearerGet(xTweetsAddress+"/"+postID+"?tweet.fields="+fields, target.Token))
	if !answered.answered() {
		return Numbers{}, answered.noAnswer
	}
	if !answered.ok() {
		return Numbers{}, numbersFailureForStatus(answered.status)
	}
	var read struct {
		Data *xPostNumbers `json:"data"`
		// Only each problem's type is read, never X's words.
		Errors []struct {
			Type string `json:"type"`
		} `json:"errors"`
	}
	if !readJSON(answered, &read) || len(read.Errors) > 20 {
		return Numbers{}, "unexpected_answer"
	}
	notFound := false
	for _, problem := range read.Errors {
		if utf16Length(problem.Type) > 200 {
			return Numbers{}, "unexpected_answer"
		}
		notFound = notFound || strings.HasSuffix(problem.Type, xNotFoundProblem)
	}
	// A post deleted on X: a 404 (above), or a 200 holding only the problem.
	if read.Data == nil && notFound {
		return Numbers{}, "not_found"
	}
	numbers, ok := xNumbersOf(read.Data)
	if !ok {
		return Numbers{}, "unexpected_answer"
	}
	// Any other 200 without data holds no number.
	return collectedOrNothing(numbers)
}

// xNumbersOf turns X's fields into ansa's columns; false when a count isn't
// one ansa can keep.
func xNumbersOf(post *xPostNumbers) (Numbers, bool) {
	var numbers Numbers
	if post == nil {
		return numbers, true
	}
	allRead := true
	read := func(number whole) *int64 {
		value, ok := count(number)
		allRead = allRead && ok
		return value
	}
	if post.Public != nil {
		numbers.Views = read(post.Public.Impressions)
		numbers.Reactions = read(post.Public.Likes)
		numbers.Comments = read(post.Public.Replies)
		numbers.Shares = sumOfBoth(read(post.Public.Reposts), read(post.Public.Quotes))
	}
	if post.Private != nil {
		numbers.Clicks = read(post.Private.LinkClicks)
	}
	return numbers, allRead
}
