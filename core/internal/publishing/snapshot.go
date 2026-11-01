package publishing

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
)

// snapshot is what the check right before sending decides on, and what
// goes out: the published text, a video's title, and where the draft's
// image or video is stored (nil: none attached).
type snapshot struct {
	check    RunInput
	platform string
	text     string
	title    string
	media    *attachedMedia
}

// readSnapshot reads one claimed job in ONE snapshot (a repeatable read,
// read-only transaction): the job, its draft as stored now, whether its
// approver is still an active owner, its rule and the owners behind it, its
// account, its image or video, and the confirmed facts now. Nothing is
// trusted from when it was scheduled. nil: this run no longer holds the job.
func readSnapshot(ctx context.Context, pool *database.Pool, claim *Claim) (*snapshot, error) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	const statement = `
		SELECT ` + drafts.Columns + `,
			publish_jobs.approval_mode, publish_jobs.approved_version, approver.id IS NOT NULL,
			rules.id IS NOT NULL, COALESCE(rules.enabled, false), COALESCE(rules.platform, ''), COALESCE(rules.pillar, ''),
			creator.id IS NOT NULL AND enabler.id IS NOT NULL,
			COALESCE(social_connections.platform, ''), COALESCE(social_connections.status, '')
		FROM publish_jobs
		JOIN content_drafts ON content_drafts.company_id = publish_jobs.company_id AND content_drafts.id = publish_jobs.draft_id
		LEFT JOIN users AS approver ON approver.company_id = publish_jobs.company_id AND approver.id = content_drafts.approved_by_user_id
			AND approver.role = 'owner' AND approver.email_verified AND approver.deactivated_at IS NULL
		LEFT JOIN autopublish_rules AS rules ON rules.company_id = publish_jobs.company_id AND rules.id = publish_jobs.autopublish_rule_id
		LEFT JOIN users AS creator ON creator.company_id = publish_jobs.company_id AND creator.id = rules.created_by_user_id
			AND creator.role = 'owner' AND creator.email_verified AND creator.deactivated_at IS NULL
		LEFT JOIN users AS enabler ON enabler.company_id = publish_jobs.company_id AND enabler.id = rules.enabled_by_user_id
			AND enabler.role = 'owner' AND enabler.email_verified AND enabler.deactivated_at IS NULL
		LEFT JOIN social_connections ON social_connections.company_id = publish_jobs.company_id AND social_connections.id = publish_jobs.connection_id
		WHERE publish_jobs.company_id = $1 AND publish_jobs.id = $2 AND publish_jobs.status = 'publishing' AND publish_jobs.claim_id = $3`
	var in RunInput
	var draft drafts.Draft
	var hasRule bool
	var rule Rule
	// The draft's columns first: the statement's first piece names no table.
	targets := append(draft.Targets(), &in.ApprovalMode, &in.ApprovedVersion, &in.ApproverActiveOwner, &hasRule, &rule.Enabled, &rule.Platform, &rule.Pillar, &rule.OwnersActive, &in.AccountPlatform, &in.AccountStatus)
	err = tx.QueryRow(ctx, statement, claim.Company.String(), claim.JobID, claim.ClaimID).Scan(targets...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	facts, err := drafts.ConfirmedFacts(ctx, tx, claim.Company)
	if err != nil {
		return nil, err
	}
	// The same snapshot: the draft's title, script and media as read above.
	content, err := readContentWithin(ctx, tx, claim.Company, claim.DraftID)
	if err != nil {
		return nil, err
	}
	in.Draft, in.Blocked = forChecks(&draft, content, facts)
	if hasRule {
		in.Rule = &rule
	}
	text := contentrules.PublishedText(contentrules.Post{Body: draft.Body, CallToAction: draft.CallToAction, Hashtags: draft.Hashtags})
	return &snapshot{check: in, platform: draft.Platform, text: text, title: content.Title, media: content.Media}, nil
}
