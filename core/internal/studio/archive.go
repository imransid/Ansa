package studio

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/publishing"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// Archive archives one draft: nobody approves or publishes it while it is
// archived, and an approval it had is gone. Anyone in the company.
func Archive(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, draftID string) (string, error) {
	var outcome string
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		draft, refusal, err := lockForDecision(ctx, tx, company, actorUserID, draftID, false)
		switch {
		case err != nil || refusal != "":
			outcome = refusal
			return err
		case draft.Status == "archived":
			outcome = Unchanged
			return nil
		case !drafts.In(drafts.ArchivableStatuses, draft.Status):
			outcome = WrongStatus
			return nil
		}
		if _, err := tx.Exec(ctx, `UPDATE content_drafts SET status = 'archived', approved_by_user_id = NULL, approved_at = NULL, approved_version = NULL, claims_acknowledged_by_user_id = NULL, claims_acknowledged_at = NULL WHERE company_id = $1 AND id = $2`, company.String(), draftID); err != nil {
			return err
		}
		outcome = Changed
		if err := publishing.RecordActivityWithin(ctx, tx, company, publishing.Activity{Action: "draft_archived", ActorUserID: actorUserID, DraftID: draftID}); err != nil {
			return err
		}
		return publishing.CancelQueuedOfDraftWithin(ctx, tx, company, actorUserID, draftID, "draft_archived")
	})
	return outcome, err
}

// Restore makes an archived draft a draft again (an idea when nothing is
// written), to be approved again. Anyone in the company. One that isn't
// archived (someone restored it meanwhile) is Unchanged.
func Restore(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, draftID string) (string, error) {
	var outcome string
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		draft, refusal, err := lockForDecision(ctx, tx, company, actorUserID, draftID, false)
		switch {
		case err != nil || refusal != "":
			outcome = refusal
			return err
		case draft.Status != "archived":
			outcome = Unchanged
			return nil
		}
		status := drafts.StatusAfterContentChange(draft.Fields, draft.MediaAssetID != nil)
		if _, err := tx.Exec(ctx, `UPDATE content_drafts SET status = $3, approved_by_user_id = NULL, approved_at = NULL, approved_version = NULL, claims_acknowledged_by_user_id = NULL, claims_acknowledged_at = NULL WHERE company_id = $1 AND id = $2`, company.String(), draftID, status); err != nil {
			return err
		}
		outcome = Changed
		return publishing.RecordActivityWithin(ctx, tx, company, publishing.Activity{Action: "draft_restored", ActorUserID: actorUserID, DraftID: draftID})
	})
	return outcome, err
}

// lockForDecision reads the person's role (FOR SHARE), then the draft (FOR
// UPDATE): NotFound, or NotAllowed for someone not active in the company
// (or, when ownersOnly, not an owner).
func lockForDecision(ctx context.Context, tx database.Tx, company tenant.CompanyID, actorUserID, draftID string, ownersOnly bool) (*drafts.LockedContent, string, error) {
	role, err := team.RoleWithin(ctx, tx, company, actorUserID)
	if err != nil {
		return nil, "", err
	}
	draft, err := drafts.LockContentWithin(ctx, tx, company, draftID)
	switch {
	case errors.Is(err, drafts.ErrNotFound):
		return nil, NotFound, nil
	case err != nil:
		return nil, "", err
	case role == "" || (ownersOnly && role != "owner"):
		return nil, NotAllowed, nil
	}
	return draft, "", nil
}

// rowQuerier is a pool or a transaction.
type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// attachedMedia is the draft's image or video with its alt text, read
// within the company (nil: none). No lock of its own: a delete or an alt
// text change locks every draft using it first, so while the draft is
// locked its asset stays as read.
func attachedMedia(ctx context.Context, q rowQuerier, company tenant.CompanyID, assetID *string) (*contentrules.Media, error) {
	if assetID == nil {
		return nil, nil
	}
	var media contentrules.Media
	err := q.QueryRow(ctx, `SELECT kind, alt_text FROM media_assets WHERE company_id = $1 AND id = $2`, company.String(), *assetID).Scan(&media.Kind, &media.AltText)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &media, err
}
