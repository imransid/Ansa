package publishing

import (
	"context"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/tenant"
)

// Activity is one row of the Co-Founder's activity log (cofounder_activity),
// written by the change it records, in its transaction. Never a token or a
// post's text. "" = none (an empty actor is the app itself).
type Activity struct {
	Action, ActorUserID, DraftID, JobID, ConnectionID, RuleID, Code string
}

// recordWithin writes activity rows of one company.
func recordWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, entries ...Activity) error {
	const insert = `
		INSERT INTO cofounder_activity (company_id, actor_user_id, action, draft_id, job_id, connection_id, rule_id, code)
		VALUES ($1, NULLIF($2, '')::uuid, $3, NULLIF($4, '')::uuid, NULLIF($5, '')::uuid, NULLIF($6, '')::uuid, NULLIF($7, '')::uuid, NULLIF($8, ''))`
	for _, entry := range entries {
		if _, err := tx.Exec(ctx, insert, company.String(), entry.ActorUserID, entry.Action, entry.DraftID, entry.JobID, entry.ConnectionID, entry.RuleID, entry.Code); err != nil {
			return err
		}
	}
	return nil
}

// forChecks is a stored draft as the pure checks read it, with what the
// confirmed facts now say about it: blocked by a platform rule or a word to
// avoid, and whether its claims need an owner.
func forChecks(d *drafts.Draft, factsNow map[string]string) (Draft, bool) {
	post := contentrules.Post{Body: d.Body, CallToAction: d.CallToAction, Hashtags: d.Hashtags}
	blocked := d.Platform == "facebook" && len(contentrules.FacebookProblems(post, contentrules.ReadWordsToAvoid(factsNow["words_to_avoid"]))) > 0
	return Draft{
		Platform: d.Platform, Format: d.Format, Status: d.Status, Pillar: d.Pillar, Version: d.Version,
		ApprovedByUserID: d.ApprovedByUserID, ApprovedVersion: d.ApprovedVersion,
		ClaimsChecked: drafts.ClaimsChecked(*d, factsNow),
	}, blocked
}
