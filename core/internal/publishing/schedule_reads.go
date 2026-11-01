package publishing

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// What deciding a schedule (or a Retry) reads, inside its transaction after
// the draft's row is locked: the people, the rule and the accounts locked
// FOR SHARE, so a demotion, a rule switched off or a disconnect saved at
// that moment is waited for, then seen.

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
