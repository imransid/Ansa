package publishing

import (
	"context"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Activity is one row of the Co-Founder's activity log (cofounder_activity),
// written by the change it records, in its transaction. Never a token or a
// post's text. "" = none (an empty actor is the app itself).
type Activity struct {
	Action, ActorUserID, DraftID, JobID, ConnectionID, RuleID, Code string
}

// RecordActivityWithin writes activity rows of one company inside the
// caller's transaction (the social accounts' connects and disconnects).
func RecordActivityWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, entries ...Activity) error {
	return recordWithin(ctx, tx, company, entries...)
}

// recordWithin writes activity rows of one company. A person's id is text
// (Better Auth's ids aren't uuids: never cast it to one).
func recordWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, entries ...Activity) error {
	const insert = `
		INSERT INTO cofounder_activity (company_id, actor_user_id, action, draft_id, job_id, connection_id, rule_id, code)
		VALUES ($1, NULLIF($2, ''), $3, NULLIF($4, '')::uuid, NULLIF($5, '')::uuid, NULLIF($6, '')::uuid, NULLIF($7, '')::uuid, NULLIF($8, ''))`
	for _, entry := range entries {
		if _, err := tx.Exec(ctx, insert, company.String(), entry.ActorUserID, entry.Action, entry.DraftID, entry.JobID, entry.ConnectionID, entry.RuleID, entry.Code); err != nil {
			return err
		}
	}
	return nil
}
