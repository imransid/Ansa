package packages

import (
	"context"
	"testing"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

type world struct {
	t         *testing.T
	pool      *database.Pool
	companyID string
	company   tenant.CompanyID
}

func newWorld(t *testing.T) *world {
	pool := database.ForTest(t)
	w := &world{t: t, pool: pool}
	w.companyID = database.TestCompany(t, pool)
	w.company, _ = tenant.FromTrustedSource(w.companyID)
	return w
}

func (w *world) exec(statement string, args ...any) {
	if _, err := w.pool.Exec(context.Background(), statement, args...); err != nil {
		w.t.Fatalf("setup: %v", err)
	}
}

func (w *world) packageNow() string {
	pkg, err := Of(context.Background(), w.pool, w.company, time.Now())
	if err != nil {
		w.t.Fatal(err)
	}
	return pkg.Key
}

func (w *world) subscribe(status, key string) {
	w.exec(`INSERT INTO company_billing (company_id, stripe_customer_id, stripe_subscription_id, status, package) VALUES ($1, $2, $3, $4::subscription_status, $5)
		ON CONFLICT (company_id) DO UPDATE SET status = EXCLUDED.status, package = EXCLUDED.package`, w.companyID, "cus_"+w.companyID, "sub_"+w.companyID, status, key)
}

// A new company is on the free trial; after it, nothing until a package is
// paid; a live subscription's package holds while Stripe still retries.
func TestTheTrialThenNothingUntilAPackageIsPaid(t *testing.T) {
	w := newWorld(t)
	if w.packageNow() != "trial" {
		t.Fatal("a new company has the free trial")
	}
	w.exec(`UPDATE companies SET trial_ends_at = now() - interval '1 minute' WHERE id = $1`, w.companyID)
	if w.packageNow() != "none" {
		t.Fatal("after the trial, no package")
	}
	w.subscribe("active", "pro")
	if w.packageNow() != "pro" {
		t.Fatal("a paid package")
	}
	w.subscribe("past_due", "pro")
	if w.packageNow() != "pro" {
		t.Fatal("kept while Stripe retries the payment")
	}
	w.subscribe("canceled", "pro")
	if w.packageNow() != "none" {
		t.Fatal("a canceled subscription holds nothing")
	}
}

// The month's AI replies are counted up to the package's limit and never
// past it; with none left, nothing is counted.
func TestAIRepliesStopAtThePackagesLimit(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	now := time.Now()
	w.exec(`INSERT INTO usage_months (company_id, month, ai_replies) VALUES ($1, $2, $3)`, w.companyID, Month(now), Trial.AIReplies-1)
	if taken, err := TakeAIReply(ctx, w.pool, w.company, now); err != nil || !taken {
		t.Fatalf("the last reply of the trial: %v %v", taken, err)
	}
	if taken, _ := TakeAIReply(ctx, w.pool, w.company, now); taken {
		t.Fatal("none left")
	}
	if used, _ := ReadUsage(ctx, w.pool, w.company, now); used.AIReplies != Trial.AIReplies {
		t.Fatalf("never counted past the limit: %d", used.AIReplies)
	}
	w.subscribe("active", "business")
	if taken, _ := TakeAIReply(ctx, w.pool, w.company, now.AddDate(0, 1, 0)); !taken {
		t.Fatal("a new month starts again")
	}
	w.subscribe("canceled", "business")
	w.exec(`UPDATE companies SET trial_ends_at = now() - interval '1 minute' WHERE id = $1`, w.companyID)
	if taken, _ := TakeAIReply(ctx, w.pool, w.company, now.AddDate(0, 2, 0)); taken {
		t.Fatal("no package, no AI replies")
	}
}

// Call minutes: the month's finished calls and the live call's time so far.
func TestCallMinutesCountFinishedCallsAndTheLiveOne(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	now := time.Now()
	err := database.InTx(ctx, w.pool, func(tx database.Tx) error {
		return AddCallSecondsWithin(ctx, tx, w.company, now, Trial.CallMinutes*60-30)
	})
	if err != nil {
		t.Fatal(err)
	}
	if left, _ := CallTimeLeft(ctx, w.pool, w.company, now, 20); !left {
		t.Fatal("ten seconds left")
	}
	if left, _ := CallTimeLeft(ctx, w.pool, w.company, now, 30); left {
		t.Fatal("the live call used the rest")
	}
}

// Team members count active people and pending invites.
func TestTeamSeatsCountPeopleAndPendingInvites(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	owner := database.TestOwner(t, w.pool, w.companyID)
	seatLeft := func() bool {
		var left bool
		database.InTx(ctx, w.pool, func(tx database.Tx) error {
			var err error
			left, err = TeamSeatLeftWithin(ctx, tx, w.company, time.Now())
			return err
		})
		return left
	}
	w.subscribe("active", "personal")
	if seatLeft() {
		t.Fatal("Personal is one person")
	}
	w.subscribe("active", "business")
	w.exec(`INSERT INTO invites (company_id, email, role, token_hash, created_by_user_id, expires_at) VALUES ($1, 'a@x.example', 'member', 'hash-a', $2, now() + interval '7 days')`, w.companyID, owner)
	if !seatLeft() {
		t.Fatal("Business: the owner and one invite, one seat left")
	}
	w.exec(`INSERT INTO invites (company_id, email, role, token_hash, created_by_user_id, expires_at) VALUES ($1, 'b@x.example', 'member', 'hash-b', $2, now() + interval '7 days')`, w.companyID, owner)
	if seatLeft() {
		t.Fatal("a pending invite holds a seat")
	}
}

func TestPostingFrequencies(t *testing.T) {
	if Personal.AllowsPosting("weekly") || !Business.AllowsPosting("three_a_week") || Business.AllowsPosting("daily") || !Pro.AllowsPosting("daily") {
		t.Fatal("Personal posts nothing, Business up to 3 a week, Pro every day")
	}
	if _, known := ByKey("trial"); known {
		t.Fatal("only paid packages can be chosen")
	}
}
