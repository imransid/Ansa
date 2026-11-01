package publishing

import (
	"context"
	"errors"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/social"
)

// Per company, every try counted (each post on a platform may cost ansa).
var attemptsPerCompany = ratelimit.Rule{MaxAttempts: 30, Window: 24 * time.Hour}

// When the daily limit holds a post back, it waits this long (its tries untouched).
const dailyLimitWaitSeconds = 60 * 60

// The most due posts one round sends (the companies take turns in it).
const roundSize = 50

// Runner sends due posts. LOGGING RULE: never a token, the post's text or
// anything a platform wrote: fixed lines with codes only.
type Runner struct {
	Pool    *database.Pool
	Box     *secure.Box
	Limiter *ratelimit.Limiter
	Log     *logging.Logger
	// ansa's Meta app secret ("": no real Page can post).
	FacebookAppSecret string
	// Development only: the stand-in account writes its posts to StandInDir.
	StandInsAllowed bool
	StandInDir      string
	// The real call (a test replaces it: never a platform from a test).
	PublishFacebook func(ctx context.Context, appSecret, pageID, pageToken, text string) PostResult
}

// RunDue is one round of the queue (the scheduler calls it): the posts cut
// off while sending go to a person first, then due posts of every company
// are claimed and sent, the companies taking turns (each round of turns one
// post per company, its longest waiting), so one company's long queue never
// holds up the others. onlyCompany: the tests keep to theirs. Returns how
// many posts it handled.
func (r *Runner) RunDue(ctx context.Context, onlyCompany string) (int, error) {
	handled, err := handOverCutOffJobs(ctx, r.Pool, onlyCompany)
	if err != nil {
		return handled, err
	}
	served := map[string]bool{}
	heldBack := map[string]bool{}
	for started := 0; started < roundSize; started++ {
		claim, err := claimNext(ctx, r.Pool, keys(served, heldBack), onlyCompany)
		if err == nil && claim == nil && len(served) > 0 {
			// Every company with due posts had its turn: a new round of turns.
			served = map[string]bool{}
			claim, err = claimNext(ctx, r.Pool, keys(heldBack), onlyCompany)
		}
		if err != nil || claim == nil {
			return handled, err
		}
		served[claim.Company.String()] = true
		outcome, err := r.send(ctx, claim)
		if err != nil {
			// A failure of our own leaves it "publishing": once its claim is 10
			// minutes old it goes to a person (it may have gone out).
			return handled, err
		}
		if outcome == "held_back" {
			heldBack[claim.Company.String()] = true
		}
		handled++
	}
	return handled, nil
}

func keys(sets ...map[string]bool) []string {
	var all []string
	for _, set := range sets {
		for key := range set {
			all = append(all, key)
		}
	}
	return all
}

// send checks one claimed job again and sends it: "published", "failed",
// "needs_attention", "requeued", "held_back" or "lost" (this run no longer
// held it).
func (r *Runner) send(ctx context.Context, claim *Claim) (string, error) {
	job, err := readSnapshot(ctx, r.Pool, claim)
	if err != nil || job == nil {
		return "lost", err
	}
	if reason := ReasonNotToPublish(job.check); reason != "" {
		return r.fail(ctx, claim, reason, "")
	}
	// WHY before the account is read: a post held back costs nothing more.
	over, err := r.Limiter.Over(ctx, "publish-attempts", claim.Company.String(), attemptsPerCompany)
	if err != nil {
		return "lost", err
	}
	if over {
		r.Log.Warn("publishing: held back", logging.Code("daily_limit"))
		written, err := requeue(ctx, r.Pool, claim, dailyLimitWaitSeconds, "daily_limit", false)
		return outcomeOf(written, err, "held_back")
	}
	page, err := social.PageForPosting(ctx, r.Pool, r.Box, claim.Company, claim.ConnectionID)
	switch {
	case errors.Is(err, social.ErrNotConnected):
		return r.fail(ctx, claim, "account_disconnected", "")
	case errors.Is(err, social.ErrNotUsable):
		return r.fail(ctx, claim, "account_unreadable", "")
	case err != nil:
		return "lost", err
	case page.IsStandIn && !r.StandInsAllowed, !page.IsStandIn && r.FacebookAppSecret == "":
		return r.fail(ctx, claim, "platform_not_set_up", "")
	}
	held, err := stillHeld(ctx, r.Pool, claim)
	if err != nil || held == "lost" {
		return "lost", err
	}
	if held == "too_late" {
		r.Log.Warn("publishing: delayed", logging.Code("run_too_slow"))
		written, err := requeue(ctx, r.Pool, claim, 0, "run_too_slow", false)
		return outcomeOf(written, err, "requeued")
	}
	var result PostResult
	if page.IsStandIn {
		result = publishToStandIn(r.StandInDir, "facebook", claim.JobID, job.text)
	} else {
		result = r.PublishFacebook(ctx, r.FacebookAppSecret, page.ExternalID, page.Token, job.text)
	}
	return r.save(ctx, claim, result, page.StoredToken)
}

// save records the platform's answer.
func (r *Runner) save(ctx context.Context, claim *Claim, result PostResult, storedToken string) (string, error) {
	switch {
	case result.Kind == "published":
		written, err := recordPublished(ctx, r.Pool, claim, result)
		return outcomeOf(written, err, "published")
	case result.Kind == "unclear":
		r.Log.Warn("publishing: needs attention", logging.Code(result.Code))
		written, err := recordNeedsAttention(ctx, r.Pool, claim, result.Code)
		return outcomeOf(written, err, "needs_attention")
	case result.Code == "rate_limited" && claim.Attempt < maxAttempts:
		r.Log.Warn("publishing: delayed", logging.Code(result.Code))
		wait := SecondsUntilNextTry(claim.Attempt, result.RetryAfterSeconds)
		written, err := requeue(ctx, r.Pool, claim, wait, result.Code, true)
		return outcomeOf(written, err, "requeued")
	case result.Code == "token_rejected":
		return r.fail(ctx, claim, result.Code, storedToken)
	}
	return r.fail(ctx, claim, result.Code, "")
}

func (r *Runner) fail(ctx context.Context, claim *Claim, code, storedToken string) (string, error) {
	r.Log.Warn("publishing: failed", logging.Code(code))
	written, err := recordFailed(ctx, r.Pool, claim, code, storedToken)
	return outcomeOf(written, err, "failed")
}

func outcomeOf(written bool, err error, outcome string) (string, error) {
	if err != nil || !written {
		return "lost", err
	}
	return outcome, nil
}

// SecondsUntilNextTry is when a post a platform asked to slow down is tried
// again: what the platform asked for, kept within 30 seconds and a day;
// otherwise 1, 2, 4, then 8 minutes after the first, second, third and
// fourth try.
func SecondsUntilNextTry(attempt, retryAfterSeconds int) int {
	if retryAfterSeconds > 0 {
		return min(max(retryAfterSeconds, 30), 24*60*60)
	}
	return 60 << min(max(attempt-1, 0), 10)
}
