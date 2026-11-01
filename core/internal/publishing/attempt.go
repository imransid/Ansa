package publishing

import (
	"context"
	"errors"

	"ansa/core/internal/logging"
	"ansa/core/internal/social"
)

// send checks one claimed job again and sends it: "published", "failed",
// "needs_attention", "requeued", "held_back" or "lost" (this run no longer
// held it). The order is the old run's: the check, the company's daily
// limit, the account, its image or video, the claim once more, the platform.
func (r *Runner) send(ctx context.Context, claim *Claim) (string, error) {
	job, err := readSnapshot(ctx, r.Pool, claim)
	if err != nil || job == nil {
		return "lost", err
	}
	if reason := ReasonNotToPublish(job.check); reason != "" {
		return r.fail(ctx, claim, reason, "")
	}
	sender := r.senderFor(job.platform)
	if sender == nil {
		// Never after a claim (it takes only platforms with a sender).
		return r.fail(ctx, claim, "platform_not_set_up", "")
	}
	// WHY before the account is read: a post held back costs nothing more
	// (a renewal asks the platform, a video is up to 100 MB).
	over, err := r.Limiter.Over(ctx, "publish-attempts", claim.Company.String(), attemptsPerCompany)
	if err != nil {
		return "lost", err
	}
	if over {
		r.Log.Warn("publishing: held back", logging.Code("daily_limit"))
		written, err := requeue(ctx, r.Pool, claim, dailyLimitWaitSeconds, "daily_limit", false)
		return outcomeOf(written, err, "held_back")
	}
	account, stop, err := r.readyAccount(ctx, claim, sender)
	if err != nil || stop != "" {
		return stop, err
	}
	media, problem := r.readMedia(ctx, job.media)
	switch problem {
	case "media_missing":
		return r.fail(ctx, claim, problem, "")
	case "media_unavailable":
		return r.tryAgainLater(ctx, claim, problem, 0)
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
	post := OutgoingPost{Text: job.text, Title: job.title, Media: media}
	var result PostResult
	if account.IsStandIn {
		result = publishToStandIn(r.StandInDir, job.platform, claim.JobID, post)
	} else {
		result = sender.Publish(ctx, account, post)
	}
	return r.save(ctx, claim, result, account.StoredToken)
}

// readyAccount is the account ready for one post, or the outcome of a run
// that stops there (nothing sent): "" = go on.
func (r *Runner) readyAccount(ctx context.Context, claim *Claim, sender *Sender) (*ReadyAccount, string, error) {
	account, err := sender.Ready(ctx, claim.Company, claim.ConnectionID)
	var outcome string
	switch {
	case errors.Is(err, social.ErrNeedsReconnect):
		outcome, err = r.fail(ctx, claim, "reauthorization_needed", "")
	case errors.Is(err, social.ErrNotConnected):
		outcome, err = r.fail(ctx, claim, "account_disconnected", "")
	case errors.Is(err, social.ErrNotUsable):
		outcome, err = r.fail(ctx, claim, "account_unreadable", "")
	case errors.Is(err, ErrRenewalUnavailable):
		outcome, err = r.tryAgainLater(ctx, claim, "token_refresh_unavailable", 0)
	case err != nil:
		return nil, "lost", err
	case account.IsStandIn && !r.StandInsAllowed, !account.IsStandIn && !sender.SetUp:
		outcome, err = r.fail(ctx, claim, "platform_not_set_up", "")
	}
	return account, outcome, err
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
	case result.Code == "rate_limited":
		return r.tryAgainLater(ctx, claim, result.Code, result.RetryAfterSeconds)
	case result.Code == "token_rejected":
		return r.fail(ctx, claim, result.Code, storedToken)
	}
	return r.fail(ctx, claim, result.Code, "")
}

// tryAgainLater: nothing went out. Back in the queue for a later try
// (this one counted), unless it was the last one, which fails it.
func (r *Runner) tryAgainLater(ctx context.Context, claim *Claim, code string, retryAfterSeconds int) (string, error) {
	if claim.Attempt >= maxAttempts {
		return r.fail(ctx, claim, code, "")
	}
	r.Log.Warn("publishing: delayed", logging.Code(code))
	written, err := requeue(ctx, r.Pool, claim, SecondsUntilNextTry(claim.Attempt, retryAfterSeconds), code, true)
	return outcomeOf(written, err, "requeued")
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
