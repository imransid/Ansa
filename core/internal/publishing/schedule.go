package publishing

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// ScheduleRequest is one draft to one or more of the company's accounts.
type ScheduleRequest struct {
	DraftID string
	// The version the page (or "Post for me") saw.
	ShownVersion  int
	ConnectionIDs []string
	// nil: now, by the database's clock.
	At *time.Time
	// The owner's tick "without an approval": an enabled auto-publish rule
	// covering the draft sends it.
	WithoutApproval bool
}

// Scheduled is what came of it: "scheduled" with the new jobs, or a
// refusal ("not-found", "not-allowed", "already-scheduled" or one of
// DecideSchedule's).
type Scheduled struct {
	Outcome string
	JobIDs  []string
	Mode    string
}

// Schedule schedules one draft of one company (owners only), in ONE
// transaction: the person read again FOR SHARE, the draft's row locked,
// then the approver, the rule, the accounts and the people behind them
// FOR SHARE (a demotion, a rule switched off or a disconnect saved at that
// moment is waited for, then seen), decided on the draft as stored and the
// facts as confirmed now. One job per account, the draft "scheduled", a
// "scheduled" activity row each ("auto_rule" for a rule's).
func Schedule(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, r ScheduleRequest) (Scheduled, error) {
	var result Scheduled
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		var err error
		result, err = scheduleWithin(ctx, tx, company, actorUserID, r)
		return err
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		// The partial unique index: a live job of this draft on that account
		// was saved at the same moment.
		return Scheduled{Outcome: "already-scheduled"}, nil
	}
	return result, err
}

func scheduleWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, actorUserID string, r ScheduleRequest) (Scheduled, error) {
	role, err := team.RoleWithin(ctx, tx, company, actorUserID)
	if err != nil || role != "owner" {
		return Scheduled{Outcome: "not-allowed"}, err
	}
	draft, err := drafts.LockWithin(ctx, tx, company, r.DraftID)
	if errors.Is(err, drafts.ErrNotFound) {
		return Scheduled{Outcome: "not-found"}, nil
	}
	if err != nil {
		return Scheduled{}, err
	}
	in, ruleID, err := readScheduleInputWithin(ctx, tx, company, draft, r, "")
	if err != nil {
		return Scheduled{}, err
	}
	mode, refusal := DecideSchedule(in)
	if refusal != "" {
		return Scheduled{Outcome: refusal}, nil
	}
	if mode != "auto_rule" {
		ruleID = ""
	}
	jobIDs := make([]string, 0, len(r.ConnectionIDs))
	// Every column named, never a spread of what was passed in.
	const insert = `
		INSERT INTO publish_jobs (company_id, draft_id, connection_id, scheduled_for, run_after, status, approval_mode, approved_version, autopublish_rule_id, created_by_user_id)
		VALUES ($1, $2, $3, COALESCE($4, now()), COALESCE($4, now()), 'queued', $5, $6, NULLIF($7, '')::uuid, $8)
		RETURNING id`
	for _, connectionID := range r.ConnectionIDs {
		var id string
		if err := tx.QueryRow(ctx, insert, company.String(), draft.ID, connectionID, r.At, mode, draft.Version, ruleID, actorUserID).Scan(&id); err != nil {
			return Scheduled{}, err
		}
		jobIDs = append(jobIDs, id)
	}
	if _, err := tx.Exec(ctx, `UPDATE content_drafts SET status = 'scheduled' WHERE company_id = $1 AND id = $2`, company.String(), draft.ID); err != nil {
		return Scheduled{}, err
	}
	code := ""
	if mode == "auto_rule" {
		code = "auto_rule"
	}
	for index, jobID := range jobIDs {
		entry := Activity{Action: "scheduled", ActorUserID: actorUserID, DraftID: draft.ID, JobID: jobID, ConnectionID: r.ConnectionIDs[index], Code: code}
		if err := recordWithin(ctx, tx, company, entry); err != nil {
			return Scheduled{}, err
		}
	}
	return Scheduled{Outcome: "scheduled", JobIDs: jobIDs, Mode: mode}, nil
}
