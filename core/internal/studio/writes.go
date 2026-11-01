// Package studio is the Co-Founder's content studio (the old
// db/content-draft-writes.ts, content-draft-status.ts, services/content-*.ts):
// a person's drafts, the AI's drafts, edits at the version a page showed,
// approvals, rejections, archiving and restoring. Every change of content
// is a new version and clears any approval in the SAME UPDATE, so an
// approved draft is always exactly what its owner approved; in the same
// transaction its waiting posts are canceled and the change recorded. The
// person's role is read again, locked FOR SHARE, in every transaction.
package studio

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/publishing"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// The outcomes of a change. Stale: the version is not the one the person
// saw (someone changed it meanwhile). WrongStatus: the change can't start
// from the draft's status (archived, or another owner changed it meanwhile).
const (
	Changed     = "changed"
	Unchanged   = "unchanged"
	NotFound    = "not-found"
	NotAllowed  = "not-allowed"
	Stale       = "stale"
	WrongStatus = "wrong-status"
)

// Generated is what the AI wrote and what its request held.
type Generated struct {
	Fields        drafts.Fields
	Claims        []drafts.StoredClaim
	FactsUsed     []drafts.Fact
	KnowledgeUsed []string
	PlanVersion   *int
}

// Every change of content, rejection and archive also clears the approval
// and "I checked these claims", in the same UPDATE (each statement names
// the columns itself: the tenant check reads every statement whole).

// Create saves a new draft, version 1, made by actorUserID: an idea (its
// topic only) when started blank, a draft when the AI wrote it. Every
// column named: a company, status or approval can't ride along.
func Create(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, d NewDraft, generated *Generated) (string, string, error) {
	var id, outcome string
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role == "" {
			outcome = NotAllowed
			return err
		}
		written := Generated{Fields: drafts.Fields{}, Claims: []drafts.StoredClaim{}, FactsUsed: []drafts.Fact{}, KnowledgeUsed: []string{}}
		if generated != nil {
			written = *generated
		}
		fields := drafts.KeepUsedFields(d.Platform, d.Format, written.Fields)
		claims, facts := claimsJSON(written.Claims), factsJSON(written.FactsUsed)
		const insert = `
			INSERT INTO content_drafts (company_id, platform, format, topic, pillar, campaign, title, body, hashtags, call_to_action,
				image_prompt, video_script, status, version, generated_version, claims, facts_used, knowledge_used, plan_version,
				created_by_user_id, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1, CASE WHEN $14 THEN 1 ELSE NULL END, $15, $16, $17::uuid[], $18, $19, $19)
			RETURNING id`
		outcome = "created"
		return tx.QueryRow(ctx, insert, company.String(), d.Platform, d.Format, d.Placement.Topic, d.Placement.Pillar, d.Placement.Campaign,
			fields.Title, fields.Body, fields.Hashtags, fields.CallToAction, fields.ImagePrompt, fields.VideoScript,
			drafts.StatusAfterContentChange(fields, false), generated != nil, claims, facts, orNone(written.KnowledgeUsed), written.PlanVersion,
			actorUserID).Scan(&id)
	})
	return id, outcome, err
}

// Edit saves a person's edit of one draft, when nobody changed it since
// the version they opened. Nothing different from what is stored =
// Unchanged (no new version, the approval stays).
func Edit(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, draftID string, version int, place Placement, fields drafts.Fields) (string, error) {
	var outcome string
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		current, refusal, err := lockForContentChange(ctx, tx, company, actorUserID, draftID, version)
		if err != nil || refusal != "" {
			outcome = refusal
			return err
		}
		kept := drafts.KeepUsedFields(current.Platform, current.Format, fields)
		if !differs(current, place, kept) {
			outcome = Unchanged
			return nil
		}
		const update = `
			UPDATE content_drafts SET topic = $4, pillar = $5, campaign = $6, title = $7, body = $8, hashtags = $9,
				call_to_action = $10, image_prompt = $11, video_script = $12, status = $13, version = version + 1,
				approved_by_user_id = NULL, approved_at = NULL, approved_version = NULL, claims_acknowledged_by_user_id = NULL, claims_acknowledged_at = NULL,
				updated_by_user_id = $14, updated_at = now()
			WHERE company_id = $1 AND id = $2 AND version = $3`
		_, err = tx.Exec(ctx, update, company.String(), draftID, version, place.Topic, place.Pillar, place.Campaign,
			kept.Title, kept.Body, kept.Hashtags, kept.CallToAction, kept.ImagePrompt, kept.VideoScript,
			drafts.StatusAfterContentChange(kept, current.MediaAssetID != nil), actorUserID)
		if err != nil {
			return err
		}
		outcome = Changed
		return publishing.CancelQueuedAfterChangeWithin(ctx, tx, company, actorUserID, draftID, current.ApprovedByUserID != nil)
	})
	return outcome, err
}

// SaveRegenerated saves the AI's new text as the draft's next version,
// when nobody changed the draft since the version the person regenerated
// (the AI takes a while: an edit saved meanwhile is never replaced unseen).
func SaveRegenerated(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, draftID string, version int, g Generated) (string, error) {
	var outcome string
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		current, refusal, err := lockForContentChange(ctx, tx, company, actorUserID, draftID, version)
		if err != nil || refusal != "" {
			outcome = refusal
			return err
		}
		kept := drafts.KeepUsedFields(current.Platform, current.Format, g.Fields)
		const update = `
			UPDATE content_drafts SET title = $4, body = $5, hashtags = $6, call_to_action = $7, image_prompt = $8, video_script = $9,
				status = $10, version = $3 + 1, generated_version = $3 + 1, claims = $11, facts_used = $12, knowledge_used = $13::uuid[],
				plan_version = $14, approved_by_user_id = NULL, approved_at = NULL, approved_version = NULL, claims_acknowledged_by_user_id = NULL, claims_acknowledged_at = NULL, updated_by_user_id = $15, updated_at = now()
			WHERE company_id = $1 AND id = $2 AND version = $3`
		_, err = tx.Exec(ctx, update, company.String(), draftID, version, kept.Title, kept.Body, kept.Hashtags, kept.CallToAction,
			kept.ImagePrompt, kept.VideoScript, drafts.StatusAfterContentChange(kept, current.MediaAssetID != nil),
			claimsJSON(g.Claims), factsJSON(g.FactsUsed), orNone(g.KnowledgeUsed), g.PlanVersion, actorUserID)
		if err != nil {
			return err
		}
		outcome = Changed
		return publishing.CancelQueuedAfterChangeWithin(ctx, tx, company, actorUserID, draftID, current.ApprovedByUserID != nil)
	})
	return outcome, err
}

// lockForContentChange reads the person's role (FOR SHARE) and then the
// draft (FOR UPDATE), and says why a change of content can't be saved: the
// person isn't active in the company, the draft takes no change in its
// status, or its version isn't the one the person saw.
func lockForContentChange(ctx context.Context, tx database.Tx, company tenant.CompanyID, actorUserID, draftID string, version int) (*drafts.LockedContent, string, error) {
	role, err := team.RoleWithin(ctx, tx, company, actorUserID)
	if err != nil {
		return nil, "", err
	}
	current, err := drafts.LockContentWithin(ctx, tx, company, draftID)
	switch {
	case errors.Is(err, drafts.ErrNotFound):
		return nil, NotFound, nil
	case err != nil:
		return nil, "", err
	case role == "":
		return nil, NotAllowed, nil
	case !drafts.In(drafts.EditableStatuses, current.Status):
		return nil, WrongStatus, nil
	case current.Version != version:
		return nil, Stale, nil
	}
	return current, "", nil
}

func differs(current *drafts.LockedContent, place Placement, f drafts.Fields) bool {
	stored := current.Fields
	if !slices.Equal(stored.Hashtags, f.Hashtags) {
		return true
	}
	return current.Topic != place.Topic || current.Pillar != place.Pillar || current.Campaign != place.Campaign ||
		stored.Title != f.Title || stored.Body != f.Body || stored.CallToAction != f.CallToAction ||
		stored.ImagePrompt != f.ImagePrompt || stored.VideoScript != f.VideoScript
}

// claimsJSON and factsJSON are the lists as stored: always JSON arrays
// (the database's CHECKs refuse anything else).
func claimsJSON(claims []drafts.StoredClaim) []byte {
	if claims == nil {
		claims = []drafts.StoredClaim{}
	}
	encoded, _ := json.Marshal(claims)
	return encoded
}

func factsJSON(facts []drafts.Fact) []byte {
	if facts == nil {
		facts = []drafts.Fact{}
	}
	encoded, _ := json.Marshal(facts)
	return encoded
}

func orNone(ids []string) []string {
	if ids == nil {
		return []string{}
	}
	return ids
}
