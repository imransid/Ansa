package media

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/publishing"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// A draft's image or video (the old db/content-draft-media.ts): a person
// attaching one or taking it off, a finished generation attaching its
// result, and the library deleting a file or changing its alt text (which
// is published with it). Each is a change of content: the next version,
// without any approval, in the same UPDATE, exactly like an edit, but not
// of the TEXT (generated_version comes along, so a post the AI wrote keeps
// its claims current). Its waiting posts are canceled in the same transaction.

// The outcomes of attaching (the content studio's words for the shared ones).
const (
	Changed       = "changed"
	Unchanged     = "unchanged"
	NotFound      = "not-found"
	NotAllowed    = "not-allowed"
	Stale         = "stale"
	WrongStatus   = "wrong-status"
	WrongKind     = "wrong-kind"
	MediaNotFound = "media-not-found"
)

// SetDraftMedia attaches one asset to one draft (assetID nil: takes it
// off), as the version the person saw. Lock order: the person, then the
// asset (FOR KEY SHARE: it can't be deleted meanwhile), then the draft.
func SetDraftMedia(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, draftID string, version int, assetID *string) (string, error) {
	var outcome string
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil {
			return err
		}
		kind := ""
		if assetID != nil {
			err := tx.QueryRow(ctx, `SELECT kind FROM media_assets WHERE company_id = $1 AND id = $2 FOR KEY SHARE`, company.String(), *assetID).Scan(&kind)
			if errors.Is(err, pgx.ErrNoRows) {
				outcome = MediaNotFound
				return nil
			}
			if err != nil {
				return err
			}
		}
		draft, err := drafts.LockContentWithin(ctx, tx, company, draftID)
		outcome = refuseMediaChange(draft, err, role, version, assetID, kind)
		if outcome != "" || err != nil {
			return ignoreNotFound(err)
		}
		outcome = Changed
		return writeDraftMediaWithin(ctx, tx, company, actorUserID, draftID, draftState{Status: draft.Status, Fields: draft.Fields, ApprovedByUserID: draft.ApprovedByUserID}, assetID)
	})
	return outcome, err
}

// refuseMediaChange says why a draft's media can't change ("" = it can).
func refuseMediaChange(draft *drafts.LockedContent, err error, role string, version int, assetID *string, kind string) string {
	switch {
	case errors.Is(err, drafts.ErrNotFound):
		return NotFound
	case err != nil:
		return ""
	case role == "":
		return NotAllowed
	case !drafts.In(drafts.EditableStatuses, draft.Status):
		return WrongStatus
	case draft.Version != version:
		return Stale
	case sameAsset(draft.MediaAssetID, assetID):
		return Unchanged
	case assetID != nil && drafts.MediaKindOfFormat(draft.Format) != kind:
		return WrongKind
	}
	return ""
}

// AttachGeneratedWithin attaches a just-made asset to the draft its job
// was asked for, inside the transaction that saves the asset (the draft
// already locked). Only while the draft still takes it: editable, of the
// format that takes this kind, and still at the version the request was
// made at. WHY the version: a request stuck for hours must never replace
// what was attached, edited or approved since. The asset stays in the
// library either way.
func AttachGeneratedWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, actorUserID, draftID string, draft *drafts.LockedContent, askedAtVersion int, assetID, kind string) (bool, error) {
	takesIt := drafts.In(drafts.EditableStatuses, draft.Status) && drafts.MediaKindOfFormat(draft.Format) == kind
	if !takesIt || draft.Version != askedAtVersion {
		return false, nil
	}
	state := draftState{Status: draft.Status, Fields: draft.Fields, ApprovedByUserID: draft.ApprovedByUserID}
	return true, writeDraftMediaWithin(ctx, tx, company, actorUserID, draftID, state, &assetID)
}

// draftState is what a change of media decides on.
type draftState struct {
	Status           string
	Fields           drafts.Fields
	ApprovedByUserID *string
}

// writeDraftMediaWithin is the UPDATE every change of a draft's media
// shares: the media (nil: none), the next version, no approval, who changed
// it. A draft with nothing written becomes a draft once something is
// attached, an idea again once it is taken off; an archived one stays archived.
func writeDraftMediaWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, actorUserID, draftID string, draft draftState, assetID *string) error {
	status := draft.Status
	if status != "archived" {
		status = drafts.StatusAfterContentChange(draft.Fields, assetID != nil)
	}
	const update = `
		UPDATE content_drafts SET media_asset_id = $3, status = $4, version = version + 1,
			generated_version = CASE WHEN generated_version = version THEN version + 1 ELSE generated_version END,
			approved_by_user_id = NULL, approved_at = NULL, approved_version = NULL, claims_acknowledged_by_user_id = NULL, claims_acknowledged_at = NULL,
			updated_by_user_id = $5, updated_at = now()
		WHERE company_id = $1 AND id = $2`
	if _, err := tx.Exec(ctx, update, company.String(), draftID, assetID, status, actorUserID); err != nil {
		return err
	}
	return publishing.CancelQueuedAfterChangeWithin(ctx, tx, company, actorUserID, draftID, draft.ApprovedByUserID != nil)
}

// usingDraft is a draft using one asset, as the library's changes decide on it.
type usingDraft struct {
	ID, Topic string
	draftState
}

// lockDraftsUsingWithin locks EVERY draft of one company using one asset
// FOR UPDATE: a delete or an alt text change locks them all before
// changing anything, so an approval or an attach of that asset waits for
// it, or it for them.
func lockDraftsUsingWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, assetID string) ([]usingDraft, error) {
	rows, err := tx.Query(ctx, `
		SELECT id::text, topic, status, title, body, hashtags, call_to_action, image_prompt, video_script, approved_by_user_id
		FROM content_drafts WHERE company_id = $1 AND media_asset_id = $2 FOR UPDATE`, company.String(), assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var using []usingDraft
	for rows.Next() {
		var d usingDraft
		f := &d.Fields
		if err := rows.Scan(&d.ID, &d.Topic, &d.Status, &f.Title, &f.Body, &f.Hashtags, &f.CallToAction, &f.ImagePrompt, &f.VideoScript, &d.ApprovedByUserID); err != nil {
			return nil, err
		}
		using = append(using, d)
	}
	return using, rows.Err()
}

func sameAsset(current, wanted *string) bool {
	if current == nil || wanted == nil {
		return current == nil && wanted == nil
	}
	return *current == *wanted
}

func ignoreNotFound(err error) error {
	if errors.Is(err, drafts.ErrNotFound) {
		return nil
	}
	return err
}
