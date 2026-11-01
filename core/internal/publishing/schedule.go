package publishing

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
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

// readScheduleInputWithin reads what deciding a schedule needs, after the
// draft's row is locked, and the covering rule's id ("" = none).
// excludeJobID: a Retry's own job, which doesn't count as already there.
func readScheduleInputWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, draft *drafts.Draft, r ScheduleRequest, excludeJobID string) (ScheduleInput, string, error) {
	facts, err := drafts.ConfirmedFacts(ctx, tx, company)
	if err != nil {
		return ScheduleInput{}, "", err
	}
	content, err := readContentWithin(ctx, tx, company, draft.ID)
	if err != nil {
		return ScheduleInput{}, "", err
	}
	checked, blocked := forChecks(draft, content, facts)
	in := ScheduleInput{ShownVersion: r.ShownVersion, WithoutApproval: r.WithoutApproval, Draft: checked, PickedAccounts: r.ConnectionIDs, Blocked: blocked}
	if draft.ApprovedByUserID != nil {
		role, err := team.RoleWithin(ctx, tx, company, *draft.ApprovedByUserID)
		if err != nil {
			return ScheduleInput{}, "", err
		}
		in.ApproverActiveOwner = role == "owner"
	}
	rule, ruleID, err := lockRuleCoveringWithin(ctx, tx, company, draft.Platform, draft.Pillar)
	if err != nil {
		return ScheduleInput{}, "", err
	}
	in.Rule = rule
	if in.Accounts, err = lockAccountsWithin(ctx, tx, company, r.ConnectionIDs); err != nil {
		return ScheduleInput{}, "", err
	}
	in.AccountsWithLive, err = accountsWithLiveJobWithin(ctx, tx, company, draft.ID, r.ConnectionIDs, excludeJobID)
	return in, ruleID, err
}

// lockRuleCoveringWithin is the enabled rule covering a draft best (its own
// pillar first, then any pillar), locked FOR SHARE, with whether the owners
// who made it and switched it on are still active owners.
func lockRuleCoveringWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, platform, pillar string) (*Rule, string, error) {
	const statement = `
		SELECT id, platform, pillar, created_by_user_id, enabled_by_user_id FROM autopublish_rules
		WHERE company_id = $1 AND platform = $2 AND enabled AND (pillar = '' OR pillar = $3)
		ORDER BY pillar = '' LIMIT 1 FOR SHARE`
	var rule Rule
	var id, creator string
	var enabler *string
	err := tx.QueryRow(ctx, statement, company.String(), platform, pillar).Scan(&id, &rule.Platform, &rule.Pillar, &creator, &enabler)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	rule.Enabled = true
	creatorRole, err := team.RoleWithin(ctx, tx, company, creator)
	if err != nil || enabler == nil {
		return &rule, id, err
	}
	enablerRole, err := team.RoleWithin(ctx, tx, company, *enabler)
	rule.OwnersActive = creatorRole == "owner" && enablerRole == "owner"
	return &rule, id, err
}

// lockAccountsWithin are the picked accounts found in the company: platform
// and status by id, locked FOR SHARE.
func lockAccountsWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, ids []string) (map[string][2]string, error) {
	rows, err := tx.Query(ctx, `SELECT id, platform, status FROM social_connections WHERE company_id = $1 AND id::text = ANY($2::text[]) FOR SHARE`, company.String(), ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	accounts := map[string][2]string{}
	for rows.Next() {
		var id, platform, status string
		if err := rows.Scan(&id, &platform, &status); err != nil {
			return nil, err
		}
		accounts[id] = [2]string{platform, status}
	}
	return accounts, rows.Err()
}

// accountsWithLiveJobWithin are the picked accounts that have this draft
// on its way, out or waiting for a person already (but excludeJobID: "" = none).
func accountsWithLiveJobWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, draftID string, ids []string, excludeJobID string) ([]string, error) {
	const statement = `
		SELECT connection_id FROM publish_jobs
		WHERE company_id = $1 AND draft_id = $2 AND connection_id::text = ANY($3::text[])
			AND status IN ('queued', 'publishing', 'published', 'needs_attention') AND id::text <> $4`
	rows, err := tx.Query(ctx, statement, company.String(), draftID, ids, excludeJobID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var live []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		live = append(live, id)
	}
	return live, rows.Err()
}
