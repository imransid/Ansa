package publishing

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// An owner's auto-publish rules on the queue page (the old
// db/autopublish-rules.ts): a rule lets a platform's drafts of one content
// pillar (or any) be scheduled without an approval of their own, when they
// break no rule and make no claim an owner would have to check. Owners
// only, the role read again FOR SHARE in the transaction. A new rule is
// switched OFF; only an owner's switch turns one on (switchRuleWithin, the
// ONE write that sets enabled), and both its maker and its switcher must
// stay active owners for it to send anything (checked when scheduling and
// again when each post runs).

// CreateRule makes a rule for one platform and pillar ("" = any) of one
// company, switched off: "created" with its id, "exists" (one for that
// platform and pillar, whatever the pillar's case) or "not-allowed".
func CreateRule(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, platform, pillar string) (outcome, ruleID string, err error) {
	err = database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role != "owner" {
			outcome = "not-allowed"
			return err
		}
		const insert = `
			INSERT INTO autopublish_rules (company_id, platform, pillar, enabled, created_by_user_id)
			VALUES ($1, $2, $3, false, $4)
			ON CONFLICT DO NOTHING
			RETURNING id`
		err = tx.QueryRow(ctx, insert, company.String(), platform, pillar, actorUserID).Scan(&ruleID)
		if errors.Is(err, pgx.ErrNoRows) {
			outcome = "exists"
			return nil
		}
		if err != nil {
			return err
		}
		outcome = "created"
		return recordWithin(ctx, tx, company, Activity{Action: "rule_created", ActorUserID: actorUserID, RuleID: ruleID})
	})
	return outcome, ruleID, err
}

// SetRuleEnabled switches one of the company's rules on (naming who did it,
// and when: the page asked first) or off, while actorUserID is an active
// owner. Posts already scheduled under a rule switched off fail when they
// run. "changed", "unchanged", "not-found" or "not-allowed".
func SetRuleEnabled(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, ruleID string, on bool) (string, error) {
	outcome := "changed"
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role != "owner" {
			outcome = "not-allowed"
			return err
		}
		var enabled bool
		const find = `SELECT enabled FROM autopublish_rules WHERE company_id = $1 AND id::text = $2 FOR UPDATE`
		err = tx.QueryRow(ctx, find, company.String(), ruleID).Scan(&enabled)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			outcome = "not-found"
			return nil
		case err != nil:
			return err
		case enabled == on:
			outcome = "unchanged"
			return nil
		}
		return switchRuleWithin(ctx, tx, company, actorUserID, ruleID, on)
	})
	return outcome, err
}

// switchRuleWithin switches a rule (its row locked by the caller, its
// owner checked) on, naming who and when, or off, and records it. The ONE
// write in core that sets a rule's enabled: an owner's explicit switch.
func switchRuleWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, actorUserID, ruleID string, on bool) error {
	const update = `
		UPDATE autopublish_rules SET enabled = $3, enabled_by_user_id = CASE WHEN $3 THEN $4::text END, enabled_at = CASE WHEN $3 THEN now() END, updated_at = now()
		WHERE company_id = $1 AND id = $2`
	if _, err := tx.Exec(ctx, update, company.String(), ruleID, on, actorUserID); err != nil {
		return err
	}
	action := "rule_disabled"
	if on {
		action = "rule_enabled"
	}
	return recordWithin(ctx, tx, company, Activity{Action: action, ActorUserID: actorUserID, RuleID: ruleID})
}
