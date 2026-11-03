package comments

import (
	"context"
	"encoding/json"
	"regexp"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/packages"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// The hourly ceilings (a flood, or a busy boosted post): per business, and
// per commenter on one Page. Past them a comment is skipped ("limit").
var (
	companyCommentLimit   = ratelimit.Rule{MaxAttempts: 100, Window: time.Hour}
	commenterCommentLimit = ratelimit.Rule{MaxAttempts: 5, Window: time.Hour}
)

// Answerer runs the answering job: it decides once what ansa does with a
// comment, then sends what is due.
type Answerer struct {
	Pool    *database.Pool
	Box     *secure.Box
	Limiter *ratelimit.Limiter
	Brain   *brainclient.Client
	Log     *logging.Logger
	// ansa's Meta app secret (every Graph call is signed with it), and
	// whether the development stand-in Page may answer (never in production).
	MetaAppSecret   string
	StandInsAllowed bool
	StandInDir      string
	// Tests set the clock; nil = the real one.
	Now func() time.Time
}

var idPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// HandleJob runs the "comment.answer" job.
func (a *Answerer) HandleJob(ctx context.Context, job *jobs.Job) error {
	var p payload
	if json.Unmarshal(job.Payload, &p) != nil || !idPattern.MatchString(p.CommentID) {
		return &jobs.Failure{Code: "bad_payload", Permanent: true}
	}
	outcome, err := a.Answer(ctx, job.CompanyID, p.CommentID)
	if err == nil {
		a.Log.Info("comments: run finished", logging.Code(outcome))
	}
	return err
}

// Answer decides what ansa does with the comment (only once: a retried run
// finds it decided) and sends what is due. The outcome is a code for the log.
func (a *Answerer) Answer(ctx context.Context, company tenant.CompanyID, commentID string) (string, error) {
	c, err := readComment(ctx, a.Pool, company, commentID)
	if err != nil || c == nil {
		return "not_found", err
	}
	if c.Status == StatusNew && c.DecidedAt == nil {
		if err := a.decide(ctx, company, c); err != nil {
			return "", err
		}
		if c, err = readComment(ctx, a.Pool, company, commentID); err != nil || c == nil {
			return "not_found", err
		}
	}
	return a.deliverDue(ctx, company, c)
}

// decide reads the comment against what may stop it (switched off, the
// Page, the package, the hourly ceilings), asks the brain once, and saves
// what core decided.
func (a *Answerer) decide(ctx context.Context, company tenant.CompanyID, c *comment) error {
	found, err := readSwitches(ctx, a.Pool, company, c.ConnectionID)
	if err != nil {
		return err
	}
	pkg, err := packages.Of(ctx, a.Pool, company, a.now())
	if err != nil {
		return err
	}
	if reason := found.skipNowReason(pkg.AnswersComments()); reason != "" {
		return markSkipped(ctx, a.Pool, company, c.ID, "", reason)
	}
	if over, err := a.overALimit(ctx, company, c); err != nil || over {
		if err != nil {
			return err
		}
		return markSkipped(ctx, a.Pool, company, c.ID, "", SkipLimit)
	}
	text, err := a.Box.Decrypt(c.TextEncrypted, TextContext(company, c.ID, "text"))
	if err != nil {
		return markFailed(ctx, a.Pool, company, c.ID)
	}
	read, err := a.gather(ctx, company, c, text, found.PageStandIn)
	if err != nil {
		return err
	}
	if !read.OwnKey && !read.KeyUnreadable {
		taken, err := packages.TakeAIReply(ctx, a.Pool, company, a.now())
		if err != nil {
			return err
		}
		if !taken {
			return markSkipped(ctx, a.Pool, company, c.ID, "", SkipPackage)
		}
	}
	answer := a.ask(ctx, read)
	return a.save(ctx, company, c, planFor(answer, read.planInputs(c.CommentID, text)))
}

// overALimit counts the comment against the business's and the
// commenter's hourly ceilings.
func (a *Answerer) overALimit(ctx context.Context, company tenant.CompanyID, c *comment) (bool, error) {
	if over, err := a.Limiter.Over(ctx, "comment-answers", company.String(), companyCommentLimit); err != nil || over {
		return over, err
	}
	return a.Limiter.Over(ctx, "comment-commenters", CommenterKey(company, c.PageID, c.CommenterID), commenterCommentLimit)
}

// CommenterKey names one commenter on one company's Page, for their hourly ceiling.
func CommenterKey(company tenant.CompanyID, pageID, commenterID string) string {
	return company.String() + ":" + pageID + ":" + commenterID
}

// ask asks the brain for its proposal; a failure is a proposal core hands
// to a person (model_failed), never one it sends.
func (a *Answerer) ask(ctx context.Context, read *reading) BrainAnswer {
	if read.KeyUnreadable {
		return BrainAnswer{Kind: "failed", Reason: "model_unavailable"}
	}
	var answer BrainAnswer
	if err := a.Brain.Call(ctx, "/v1/comments/reply", read.Request, &answer); err != nil {
		a.Log.Error("comments: brain unavailable", logging.ErrorType(err))
		return BrainAnswer{Kind: "failed", Reason: "model_failed"}
	}
	return answer
}

func (a *Answerer) now() time.Time {
	if a.Now != nil {
		return a.Now()
	}
	return time.Now()
}
