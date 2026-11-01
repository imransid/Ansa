package publishing

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/files"
	"ansa/core/internal/logging"
	"ansa/core/internal/platforms"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/social"
	"ansa/core/internal/tenant"
)

// Per company, every try counted (each post on a platform may cost ansa).
var attemptsPerCompany = ratelimit.Rule{MaxAttempts: 30, Window: 24 * time.Hour}

// When the daily limit holds a post back, it waits this long (its tries untouched).
const dailyLimitWaitSeconds = 60 * 60

// The most due posts one round sends (the companies take turns in it).
const roundSize = 50

// How long the run after an answer may take.
const runNowBudget = 10 * time.Minute

// The longest one post can take when everything is slow: the account made
// ready (a renewal, or waiting for another run's), its image or video read,
// the platform's slowest answer (a YouTube upload), and the database. A
// post is started only while this still fits before the run's end, so our
// own time limit never cuts one off half-way (it would then need a person's check).
const longestSend = social.LongestPreparation + mediaReadTimeout + platforms.LongestPublish + 30*time.Second

// Runner sends due posts. LOGGING RULE: never a token, the post's text, a
// file's key or anything a platform wrote: fixed lines with codes only.
type Runner struct {
	Pool    *database.Pool
	Box     *secure.Box
	Limiter *ratelimit.Limiter
	Log     *logging.Logger
	// Private file storage: a post's image or video is read right before sending.
	Files *files.Store
	// ansa's Meta app secret ("": no real Page can post).
	FacebookAppSecret string
	// Development only: the stand-in account writes its posts to StandInDir.
	StandInsAllowed bool
	StandInDir      string
	// The real call to Facebook (a test replaces it: never a platform from a test).
	PublishFacebook func(ctx context.Context, appSecret, pageID, pageToken string, post OutgoingPost) PostResult
	// LinkedIn, X and YouTube by platform, once their connectors exist
	// (see senderFor). nil: core sends to Facebook only.
	OtherSenders map[string]*Sender
	// After runs work once an answer is out (nil: its own goroutine; a test
	// runs it at once).
	After func(work func())
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
	pairs := r.claimable()
	for started := 0; started < roundSize && hasTimeFor(ctx); started++ {
		claim, err := claimNext(ctx, r.Pool, keys(served, heldBack), onlyCompany, pairs)
		if err == nil && claim == nil && len(served) > 0 {
			// Every company with due posts had its turn: a new round of turns.
			served = map[string]bool{}
			claim, err = claimNext(ctx, r.Pool, keys(heldBack), onlyCompany, pairs)
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

// RunNow sends these posts of one company one after another, each claimed
// first while it waits and is due (right after the answer that made them
// due: scheduled for now, "Publish now", a Retry). One another run took
// first is left to it. Returns the outcome of each one it sent.
func (r *Runner) RunNow(ctx context.Context, company tenant.CompanyID, jobIDs []string) ([]string, error) {
	var outcomes []string
	pairs := r.claimable()
	for _, jobID := range jobIDs {
		if !hasTimeFor(ctx) {
			// Left due: the scheduler's next round sends it.
			break
		}
		claim, err := claimJob(ctx, r.Pool, company, jobID, pairs)
		if err != nil {
			return outcomes, err
		}
		if claim == nil {
			continue
		}
		outcome, err := r.send(ctx, claim)
		if err != nil {
			return outcomes, err
		}
		outcomes = append(outcomes, outcome)
	}
	return outcomes, nil
}

// SendSoon sends these posts once the answer is out, with a time of their
// own (the request's ends with the answer). The scheduler's 15-second
// round is the fallback: a post this misses goes out with it.
func (r *Runner) SendSoon(company tenant.CompanyID, jobIDs []string) {
	work := func() {
		ctx, cancel := context.WithTimeout(context.Background(), runNowBudget)
		defer cancel()
		if _, err := r.RunNow(ctx, company, jobIDs); err != nil {
			r.Log.Error("publishing: run after the answer failed", logging.ErrorType(err))
		}
	}
	if r.After != nil {
		r.After(work)
		return
	}
	go work()
}

// hasTimeFor says whether a post's slowest run still fits before ctx ends.
func hasTimeFor(ctx context.Context) bool {
	deadline, limited := ctx.Deadline()
	return !limited || time.Until(deadline) >= longestSend
}

// SecondsUntilNextTry is when a post that couldn't go out yet is tried
// again: what the platform asked for, kept within 30 seconds and a day;
// otherwise 1, 2, 4, then 8 minutes after the first, second, third and
// fourth try.
func SecondsUntilNextTry(attempt, retryAfterSeconds int) int {
	if retryAfterSeconds > 0 {
		return min(max(retryAfterSeconds, 30), 24*60*60)
	}
	return 60 << min(max(attempt-1, 0), 10)
}
