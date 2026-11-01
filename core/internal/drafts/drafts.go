// Package drafts is a company's content drafts (the old db/content-draft-*.ts):
// one post for one platform and format. Today core creates the drafts "Post
// for me" writes and reads a draft for the publishing queue; a person's
// edits, approvals and the content studio's pages move with the content
// studio.
package drafts

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// ErrNotAllowed: the person isn't an active member of the company now.
var ErrNotAllowed = errors.New("drafts: not allowed")

// ErrNotFound: no such draft in this company.
var ErrNotFound = errors.New("drafts: not found")

// NewDraft is a draft to save, version 1.
type NewDraft struct {
	Platform, Format, Topic, Pillar, Campaign string
	Body, CallToAction                        string
	Hashtags                                  []string
	// Written by the AI: generated_version 1. "Post for me" lists no claims
	// (ansa's own checks of the text replace them).
	Generated bool
}

// Create saves a new draft of one company made by actorUserID: an idea
// when nothing is written yet, a draft otherwise. Every column named,
// never a spread of what was passed in: a company, status or approval
// can't ride along.
func Create(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, d NewDraft) (string, error) {
	var id string
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil {
			return err
		}
		if role == "" {
			return ErrNotAllowed
		}
		status := "draft"
		if d.Body == "" && d.CallToAction == "" && len(d.Hashtags) == 0 {
			status = "idea"
		}
		hashtags := d.Hashtags
		if hashtags == nil {
			hashtags = []string{}
		}
		const insert = `
			INSERT INTO content_drafts (company_id, platform, format, topic, pillar, campaign, body, hashtags, call_to_action,
				status, version, generated_version, claims, facts_used, knowledge_used, plan_version, created_by_user_id, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, CASE WHEN $11 THEN 1 ELSE NULL END, '[]'::jsonb, '[]'::jsonb, '{}'::uuid[], NULL, $12, $12)
			RETURNING id`
		return tx.QueryRow(ctx, insert, company.String(), d.Platform, d.Format, d.Topic, d.Pillar, d.Campaign, d.Body, hashtags, d.CallToAction,
			status, d.Generated, actorUserID).Scan(&id)
	})
	return id, err
}

// Draft is a draft as the publishing queue reads it.
type Draft struct {
	ID, Platform, Format, Status, Pillar string
	Version                              int
	GeneratedVersion                     *int
	ApprovedByUserID                     *string
	ApprovedVersion                      *int
	Body, CallToAction                   string
	Hashtags                             []string
	// As stored: content_drafts.claims and facts_used.
	Claims, FactsUsed json.RawMessage
	HasMedia          bool
}

// Columns is the SELECT list that Scan reads, in its order (exported so
// the publishing queue's snapshot reads a draft the same way).
const Columns = `content_drafts.id, content_drafts.platform, content_drafts.format, content_drafts.status, content_drafts.pillar,
	content_drafts.version, content_drafts.generated_version, content_drafts.approved_by_user_id, content_drafts.approved_version,
	content_drafts.body, content_drafts.call_to_action, content_drafts.hashtags, content_drafts.claims, content_drafts.facts_used,
	content_drafts.media_asset_id IS NOT NULL`

// Targets are where Scan puts each of Columns.
func (d *Draft) Targets() []any {
	return []any{&d.ID, &d.Platform, &d.Format, &d.Status, &d.Pillar, &d.Version, &d.GeneratedVersion, &d.ApprovedByUserID, &d.ApprovedVersion,
		&d.Body, &d.CallToAction, &d.Hashtags, &d.Claims, &d.FactsUsed, &d.HasMedia}
}

// LockWithin reads one draft of one company, its row locked FOR UPDATE
// until the transaction ends (the lock order everywhere: the person, the
// draft, then its jobs).
func LockWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, draftID string) (*Draft, error) {
	var d Draft
	err := tx.QueryRow(ctx, `SELECT `+Columns+` FROM content_drafts WHERE company_id = $1 AND id = $2 FOR UPDATE`, company.String(), draftID).Scan(d.Targets()...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// ConfirmedFactsWithin are the company's confirmed business facts by topic.
func ConfirmedFactsWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID) (map[string]string, error) {
	rows, err := tx.Query(ctx, `SELECT topic, confirmed_value FROM business_facts WHERE company_id = $1 AND confirmed_value IS NOT NULL`, company.String())
	if err != nil {
		return nil, err
	}
	facts := map[string]string{}
	for rows.Next() {
		var topic, value string
		if err := rows.Scan(&topic, &value); err != nil {
			rows.Close()
			return nil, err
		}
		facts[topic] = value
	}
	return facts, rows.Err()
}
