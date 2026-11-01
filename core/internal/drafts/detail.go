package drafts

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Detail is one draft with everything its page shows: who made, changed,
// approved or rejected it, and the approver's role now (an approval by
// someone made a member or removed since lets nothing go out).
type Detail struct {
	ID, Platform, Format, Status, Topic, Pillar, Campaign string
	Version                                               int
	Fields                                                Fields
	MediaAssetID                                          *string
	GeneratedVersion                                      *int
	// As stored: read with ReadStoredClaims and ReadFactsUsed.
	Claims, FactsUsed     json.RawMessage
	KnowledgeUsed         []string
	PlanVersion           *int
	CreatedAt, UpdatedAt  time.Time
	CreatedByName         *string
	UpdatedByName         *string
	ApprovedAt            *time.Time
	ApprovedVersion       *int
	ApprovedByName        *string
	ApproverRole          *string
	ApproverDeactivatedAt *time.Time
	ClaimsAcknowledgedAt  *time.Time
	RejectedAt            *time.Time
	RejectedByName        *string
	RejectionNote         *string
	PlannedFor            *time.Time
}

// Read reads one draft of one company (nil: unknown, or another company's).
// Every join of a person also matches the company.
func Read(ctx context.Context, pool *database.Pool, company tenant.CompanyID, draftID string) (*Detail, error) {
	const statement = `
		SELECT d.id, d.platform, d.format, d.status, d.topic, d.pillar, d.campaign, d.version,
			d.title, d.body, d.hashtags, d.call_to_action, d.image_prompt, d.video_script,
			d.media_asset_id::text, d.generated_version, d.claims, d.facts_used, d.knowledge_used::text[], d.plan_version,
			d.created_at, creator.name, d.updated_at, updater.name,
			d.approved_at, d.approved_version, approver.name, approver.role, approver.deactivated_at,
			d.claims_acknowledged_at, d.rejected_at, rejecter.name, d.rejection_note, d.planned_for
		FROM content_drafts AS d
		LEFT JOIN users AS creator ON creator.id = d.created_by_user_id AND creator.company_id = d.company_id
		LEFT JOIN users AS updater ON updater.id = d.updated_by_user_id AND updater.company_id = d.company_id
		LEFT JOIN users AS approver ON approver.id = d.approved_by_user_id AND approver.company_id = d.company_id
		LEFT JOIN users AS rejecter ON rejecter.id = d.rejected_by_user_id AND rejecter.company_id = d.company_id
		WHERE d.company_id = $1 AND d.id = $2`
	var d Detail
	f := &d.Fields
	err := pool.QueryRow(ctx, statement, company.String(), draftID).Scan(&d.ID, &d.Platform, &d.Format, &d.Status, &d.Topic, &d.Pillar, &d.Campaign, &d.Version,
		&f.Title, &f.Body, &f.Hashtags, &f.CallToAction, &f.ImagePrompt, &f.VideoScript,
		&d.MediaAssetID, &d.GeneratedVersion, &d.Claims, &d.FactsUsed, &d.KnowledgeUsed, &d.PlanVersion,
		&d.CreatedAt, &d.CreatedByName, &d.UpdatedAt, &d.UpdatedByName,
		&d.ApprovedAt, &d.ApprovedVersion, &d.ApprovedByName, &d.ApproverRole, &d.ApproverDeactivatedAt,
		&d.ClaimsAcknowledgedAt, &d.RejectedAt, &d.RejectedByName, &d.RejectionNote, &d.PlannedFor)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if f.Hashtags == nil {
		f.Hashtags = []string{}
	}
	if d.KnowledgeUsed == nil {
		d.KnowledgeUsed = []string{}
	}
	return &d, nil
}

// LockedContent is a draft's content as the changes decide on it, read
// with its row locked FOR UPDATE (the lock order everywhere: the person,
// then the draft).
type LockedContent struct {
	Platform, Format, Status, Topic, Pillar, Campaign string
	Version                                           int
	GeneratedVersion                                  *int
	Fields                                            Fields
	MediaAssetID                                      *string
	Claims, FactsUsed                                 json.RawMessage
	ApprovedByUserID                                  *string
	ApprovedVersion                                   *int
}

// LockContentWithin reads one draft of one company inside the caller's
// transaction, locked until it ends (ErrNotFound: not this company's).
func LockContentWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, draftID string) (*LockedContent, error) {
	const statement = `
		SELECT platform, format, status, topic, pillar, campaign, version, generated_version,
			title, body, hashtags, call_to_action, image_prompt, video_script, media_asset_id::text,
			claims, facts_used, approved_by_user_id, approved_version
		FROM content_drafts WHERE company_id = $1 AND id = $2 FOR UPDATE`
	var d LockedContent
	f := &d.Fields
	err := tx.QueryRow(ctx, statement, company.String(), draftID).Scan(&d.Platform, &d.Format, &d.Status, &d.Topic, &d.Pillar, &d.Campaign,
		&d.Version, &d.GeneratedVersion, &f.Title, &f.Body, &f.Hashtags, &f.CallToAction, &f.ImagePrompt, &f.VideoScript, &d.MediaAssetID,
		&d.Claims, &d.FactsUsed, &d.ApprovedByUserID, &d.ApprovedVersion)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if f.Hashtags == nil {
		f.Hashtags = []string{}
	}
	return &d, nil
}
