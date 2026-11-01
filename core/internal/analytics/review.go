package analytics

import (
	"context"
	"regexp"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/tenant"
)

// "Review performance" on the Analytics page (owners; the old
// services/performance-review.ts): the brain asks the AI to read one
// period's post numbers (aggregates only) and write findings that cite
// them, and recommendations. THIS CODE keeps only the findings whose every
// number is exactly one it sent (check.go); without one left, nothing is
// saved. Not asked at all below 5 posts with numbers. LOGGING RULE: never
// the numbers, the topics, the AI's answer or an error's text.

// Reviewer makes performance reviews.
type Reviewer struct {
	Pool    *database.Pool
	Limiter *ratelimit.Limiter
	Log     *logging.Logger
	// The brain, with a time long enough for two tries of 120 s.
	Brain *brainclient.Client
}

// performance-reviews: 10 an hour per company (every review is a paid AI
// call), the old counter, shared with the old backend.
var reviewsPerCompany = ratelimit.Rule{MaxAttempts: 10, Window: time.Hour}

// Outcome codes of a review request.
const (
	Saved       = "saved"
	Invalid     = "invalid"
	NotOwner    = "not_owner"
	TooFewPosts = "too_few_posts"
	Limited     = "limited"
	NoReview    = "no_review"
)

// Outcome is what came of a review request, with its words for people.
type Outcome struct {
	Code    string
	Message string
}

const (
	onlyOwners    = "Only owners ask for a performance review."
	noTimeZone    = "Your browser didn't say its timezone. Reload the page and try again."
	aiUnavailable = "The AI isn't available right now, so no review was made. Try again later."
	aiFailed      = "The AI couldn't review the numbers just now, so nothing was saved. Try again in a few minutes."
	unusable      = "The review failed: the AI's answer came back in a form that can't be used, so nothing was saved. Try again."
	allDropped    = "The review failed: every finding the AI wrote cited a number it wasn't given, or a wrong one, so nothing was saved. Try again."
)

// Review reviews the company's posts of the period the page showed
// ("7", "30" or "90"), in the owner's own time zone as the browser names
// it, and saves the review.
func (r *Reviewer) Review(ctx context.Context, company tenant.CompanyID, actorUserID string, isOwner bool, period, timeZone string, now time.Time) (Outcome, error) {
	zone, known := knownTimeZone(timeZone)
	if ParsePeriod([]string{period}) != period || !known {
		return Outcome{Invalid, noTimeZone}, nil
	}
	if !isOwner {
		return Outcome{NotOwner, onlyOwners}, nil
	}
	bounds := periodBounds(period, now)
	_, withNumbers, err := countPublished(ctx, r.Pool, company, bounds.Start, bounds.End)
	if err != nil {
		return Outcome{}, err
	}
	if postsStillNeeded(withNumbers) > 0 {
		return Outcome{TooFewPosts, describePostsStillNeeded(withNumbers) + " Nothing was sent to the AI."}, nil
	}
	if over, err := r.Limiter.Over(ctx, "performance-reviews", company.String(), reviewsPerCompany); err != nil || over {
		return Outcome{Limited, "Your company asked for a lot of reviews this hour. Wait a while and try again."}, err
	}
	posts, err := publishedPosts(ctx, r.Pool, company, bounds.Start, bounds.End, reviewPostsMax, true)
	if err != nil {
		return Outcome{}, err
	}
	input := buildReviewInput(posts, withNumbers, bounds, zone)
	review, refusal := r.askBrain(ctx, input)
	if review == nil {
		return Outcome{NoReview, refusal}, nil
	}
	saved, err := saveReview(ctx, r.Pool, company, actorUserID, bounds, input, *review)
	if err != nil || !saved {
		return Outcome{NotOwner, onlyOwners}, err
	}
	return Outcome{Code: Saved}, nil
}

// brainAnswer is the brain's review as the AI wrote it (read strictly by
// the brain), or why there is none.
type brainAnswer struct {
	Kind      string `json:"kind"`
	Reason    string `json:"reason"`
	ErrorName string `json:"error_name"`
	Review
}

// askBrain sends the input (no account, person, id or post text but the
// topic) and checks the answer: the review to save, or why there is none.
func (r *Reviewer) askBrain(ctx context.Context, input ReviewInput) (*Review, string) {
	request := map[string]any{"period": input.Period, "post_count": input.PostCount, "posts_left_out": input.PostsLeftOut, "posts": input.Posts, "groups": input.Groups}
	var answer brainAnswer
	if err := r.Brain.Call(ctx, "/v1/analytics/review", request, &answer); err != nil {
		answer = brainAnswer{Kind: "failed", Reason: "model_failed", ErrorName: "BrainUnavailable"}
	}
	switch {
	case answer.Kind == "ok":
		if checked := checkReview(answer.Review, input); checked != nil {
			return checked, ""
		}
		return nil, allDropped
	case answer.Reason == "model_unavailable":
		return nil, aiUnavailable
	case answer.Reason == "unusable_answer":
		return nil, unusable
	}
	// A fixed line with the class: a revoked key and a wrong model name need different fixes.
	r.Log.Error("claude call failed", logging.Code(safeErrorClass(answer.ErrorName)))
	return nil, aiFailed
}

var errorClassName = regexp.MustCompile(`^[A-Za-z0-9_]{1,64}$`)

func safeErrorClass(name string) string {
	if errorClassName.MatchString(name) {
		return name
	}
	return "UnknownError"
}

// IANA names ("Europe/Lisbon", "America/Argentina/Buenos_Aires") and "UTC".
var timeZonePattern = regexp.MustCompile(`^[A-Za-z0-9_+\-/]{1,100}$`)

// knownTimeZone is the zone a browser named, when this server knows it.
// "Local" is Go's word for the server's own zone, never a browser's.
func knownTimeZone(name string) (*time.Location, bool) {
	if !timeZonePattern.MatchString(name) || name == "Local" {
		return nil, false
	}
	zone, err := time.LoadLocation(name)
	return zone, err == nil
}
