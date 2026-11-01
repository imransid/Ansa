package platforms

import (
	"regexp"
	"strconv"
	"time"
)

// What every platform's numbers reader does the same way (the old
// lib/social-metrics.ts): a count is a whole number ansa can keep, or the
// answer is unreadable (never guessed or cut); a number the platform left
// out stays nil, never 0; an answer without a single number is no
// snapshot at all ("no_numbers").

// Numbers are one post's numbers, one per post_metrics column: nil = the
// platform didn't give it.
type Numbers struct {
	Views, Reach, Reactions, Comments, Shares, Clicks, VideoViews *int64
}

// CountMax is Postgres's integer: a platform's number past it is not one
// ansa can keep.
const CountMax = 2_147_483_647

// How many days after it went out a post's numbers are read (about once a
// day). X's posts for fewer: X gives link clicks only for a post's first
// 30 days, and ansa asks for them under 29; a read after that would have
// none and hide the ones read before (the page and the review show each
// post's newest snapshot). The day between leaves room for the minutes
// between claiming a post and asking X.
const (
	NumbersReadDays  = 30
	XNumbersReadDays = 28
)

// ReadDays is how many days after it went out ansa reads a post's numbers
// on the platform.
func ReadDays(platform string) int {
	if platform == "x" {
		return XNumbersReadDays
	}
	return NumbersReadDays
}

// StillRead says whether ansa still reads a post's numbers at `now`.
func StillRead(platform string, publishedAt, now time.Time) bool {
	return now.Sub(publishedAt) < time.Duration(ReadDays(platform))*24*time.Hour
}

// count is a number as a platform writes it: whole, 0 to CountMax.
func count(number whole) (*int64, bool) {
	if !number.set {
		return nil, true
	}
	if number.value < 0 || number.value > CountMax {
		return nil, false
	}
	value := number.value
	return &value, true
}

var countText = regexp.MustCompile(`^\d{1,10}$`)

// countFromText is a count YouTube writes as a string of digits.
func countFromText(text *string) (*int64, bool) {
	if text == nil {
		return nil, true
	}
	if !countText.MatchString(*text) {
		return nil, false
	}
	value, err := strconv.ParseInt(*text, 10, 64)
	if err != nil || value > CountMax {
		return nil, false
	}
	return &value, true
}

// sumOfBoth adds two counts, or nil unless the platform gave both: one
// alone would be a wrong total.
func sumOfBoth(first, second *int64) *int64 {
	if first == nil || second == nil || *first+*second > CountMax {
		return nil
	}
	sum := *first + *second
	return &sum
}

// collectedOrNothing: the numbers read, or "no_numbers" when there is none.
func collectedOrNothing(numbers Numbers) (Numbers, string) {
	for _, value := range []*int64{numbers.Views, numbers.Reach, numbers.Reactions, numbers.Comments, numbers.Shares, numbers.Clicks, numbers.VideoViews} {
		if value != nil {
			return numbers, ""
		}
	}
	return Numbers{}, "no_numbers"
}

// numbersFailureForStatus is what a refusal means, by its HTTP status. A
// 401 is the token itself: the collector marks the account as needing a
// reconnect, as publishing does.
func numbersFailureForStatus(status int) string {
	switch {
	case status == 401:
		return "token_rejected"
	case status == 403:
		return "permission_denied"
	case status == 404:
		return "not_found"
	case status == 429:
		return "rate_limited"
	case status == 400:
		return "invalid_request"
	case status >= 500:
		return "server_error"
	}
	return "unexpected_answer"
}
