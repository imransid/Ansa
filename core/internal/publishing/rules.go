package publishing

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// SetAnyPillarRule switches the company's "any pillar" auto-publish rule of
// one platform on (naming who did it, and when) or off, while actorUserID
// is an active owner, making it (switched off) first when there is none.
// Each change is in the activity log. Nothing turns a rule on by itself:
// only an owner's explicit confirm calls this with on. Posts already
// scheduled under a rule switched off fail when they run. Returns "changed",
// "unchanged" or "not-allowed".
func SetAnyPillarRule(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, platform string, on bool) (string, error) {
	outcome := "unchanged"
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role != "owner" {
			outcome = "not-allowed"
			return err
		}
		const find = `SELECT id, enabled FROM autopublish_rules WHERE company_id = $1 AND platform = $2 AND pillar = '' FOR UPDATE`
		var ruleID string
		var enabled bool
		err = tx.QueryRow(ctx, find, company.String(), platform).Scan(&ruleID, &enabled)
		if errors.Is(err, pgx.ErrNoRows) {
			if !on {
				return nil
			}
			const create = `INSERT INTO autopublish_rules (company_id, platform, pillar, enabled, created_by_user_id) VALUES ($1, $2, '', false, $3) RETURNING id`
			if err := tx.QueryRow(ctx, create, company.String(), platform, actorUserID).Scan(&ruleID); err != nil {
				return err
			}
			if err := recordWithin(ctx, tx, company, Activity{Action: "rule_created", ActorUserID: actorUserID, RuleID: ruleID}); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		if enabled == on {
			return nil
		}
		const update = `
			UPDATE autopublish_rules SET enabled = $3, enabled_by_user_id = CASE WHEN $3 THEN $4::uuid END, enabled_at = CASE WHEN $3 THEN now() END, updated_at = now()
			WHERE company_id = $1 AND id = $2`
		if _, err := tx.Exec(ctx, update, company.String(), ruleID, on, actorUserID); err != nil {
			return err
		}
		outcome = "changed"
		action := "rule_disabled"
		if on {
			action = "rule_enabled"
		}
		return recordWithin(ctx, tx, company, Activity{Action: action, ActorUserID: actorUserID, RuleID: ruleID})
	})
	return outcome, err
}

// archivable are the statuses a draft can be archived from (a published one
// stays as it went out).
var archivable = map[string]bool{"idea": true, "draft": true, "approved": true, "rejected": true, "scheduled": true, "failed": true}

// ArchiveDraft archives one draft of one company (anyone active in it): its
// approval gone, its waiting posts canceled ("draft_archived"), each in the
// activity log. Returns "changed", "unchanged" (archived already),
// "wrong-status" (published), "not-found" or "not-allowed".
func ArchiveDraft(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, draftID string) (string, error) {
	outcome := "changed"
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil {
			return err
		}
		var status string
		err = tx.QueryRow(ctx, `SELECT status FROM content_drafts WHERE company_id = $1 AND id = $2 FOR UPDATE`, company.String(), draftID).Scan(&status)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			outcome = "not-found"
			return nil
		case err != nil:
			return err
		case role == "":
			outcome = "not-allowed"
			return nil
		case status == "archived":
			outcome = "unchanged"
			return nil
		case !archivable[status]:
			outcome = "wrong-status"
			return nil
		}
		const archive = `
			UPDATE content_drafts SET status = 'archived', approved_by_user_id = NULL, approved_at = NULL, approved_version = NULL,
				claims_acknowledged_by_user_id = NULL, claims_acknowledged_at = NULL
			WHERE company_id = $1 AND id = $2`
		if _, err := tx.Exec(ctx, archive, company.String(), draftID); err != nil {
			return err
		}
		if err := recordWithin(ctx, tx, company, Activity{Action: "draft_archived", ActorUserID: actorUserID, DraftID: draftID}); err != nil {
			return err
		}
		return cancelQueuedWithin(ctx, tx, company, actorUserID, draftID, "draft_archived")
	})
	return outcome, err
}

// cancelQueuedWithin cancels a draft's waiting posts (the draft's row
// locked by the caller), saying why. A post being sent or out is never
// touched: the check right before sending catches the change.
func cancelQueuedWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, actorUserID, draftID, code string) error {
	const cancel = `
		UPDATE publish_jobs SET status = 'canceled', canceled_by_user_id = $3, updated_at = now()
		WHERE company_id = $1 AND draft_id = $2 AND status = 'queued'
		RETURNING id, connection_id`
	rows, err := tx.Query(ctx, cancel, company.String(), draftID, actorUserID)
	if err != nil {
		return err
	}
	var canceled []Activity
	for rows.Next() {
		entry := Activity{Action: "canceled", ActorUserID: actorUserID, DraftID: draftID, Code: code}
		if err := rows.Scan(&entry.JobID, &entry.ConnectionID); err != nil {
			rows.Close()
			return err
		}
		canceled = append(canceled, entry)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return recordWithin(ctx, tx, company, canceled...)
}
