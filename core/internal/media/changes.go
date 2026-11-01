package media

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// Changing an asset of the library: its alt text, and deleting it. Anyone
// active in the company, as for drafts. Lock order, for both: the person,
// the asset, then EVERY draft using it, before anything is changed.

// InUse: drafts keep the asset as it is (Drafts names them).
const InUse = "in-use"

// Change is a library change's outcome; Drafts only when InUse.
type Change struct {
	Outcome string
	Drafts  []DraftUsing
	// The deleted file's key, for the caller to remove once the row is gone.
	StorageKey string
}

// UpdateAltText saves one asset's alt text in ONE transaction: every draft
// using it gets it as its next version, without its approval (an approved
// one becomes a draft again, an archived one stays archived), or nothing
// changes while a draft that is scheduled, published or failed to publish
// uses it. WHY: it is published with the file, so an approved post is never
// published with words its owner didn't see.
func UpdateAltText(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, assetID, altText string) (Change, error) {
	var change Change
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if role, err := team.RoleWithin(ctx, tx, company, actorUserID); err != nil || role == "" {
			change.Outcome = NotAllowed
			return err
		}
		// "No key update": attaching the asset at this moment doesn't wait; a delete does.
		var current string
		err := tx.QueryRow(ctx, `SELECT alt_text FROM media_assets WHERE company_id = $1 AND id = $2 FOR NO KEY UPDATE`, company.String(), assetID).Scan(&current)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			change.Outcome = NotFound
			return nil
		case err != nil:
			return err
		case current == altText:
			change.Outcome = Unchanged
			return nil
		}
		using, keeping, err := lockAndSort(ctx, tx, company, assetID, drafts.StatusesKeepingAltText)
		if err != nil || len(keeping) > 0 {
			change = Change{Outcome: InUse, Drafts: keeping}
			return err
		}
		for _, draft := range using {
			if err := writeDraftMediaWithin(ctx, tx, company, actorUserID, draft.ID, draft.draftState, &assetID); err != nil {
				return err
			}
		}
		change.Outcome = Changed
		_, err = tx.Exec(ctx, `UPDATE media_assets SET alt_text = $3 WHERE company_id = $1 AND id = $2`, company.String(), assetID, altText)
		return err
	})
	return change, err
}

// Delete deletes one asset's row in ONE transaction: the drafts that may
// lose it lose it as their next version (an archived one stays archived),
// and the job that made it keeps its history (succeeded, its asset deleted
// since). Refused while a draft that is approved, scheduled, published or
// failed uses it. The caller removes the file once the row is gone (WHY the
// row first: the draft rules decide in its transaction; a file removed
// first would be gone even when they keep it).
func Delete(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, assetID string) (Change, error) {
	var change Change
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if role, err := team.RoleWithin(ctx, tx, company, actorUserID); err != nil || role == "" {
			change.Outcome = NotAllowed
			return err
		}
		var key string
		err := tx.QueryRow(ctx, `SELECT storage_key FROM media_assets WHERE company_id = $1 AND id = $2 FOR UPDATE`, company.String(), assetID).Scan(&key)
		if errors.Is(err, pgx.ErrNoRows) {
			change.Outcome = NotFound
			return nil
		}
		if err != nil {
			return err
		}
		using, keeping, err := lockAndSort(ctx, tx, company, assetID, drafts.StatusesKeepingMedia)
		if err != nil || len(keeping) > 0 {
			change = Change{Outcome: InUse, Drafts: keeping}
			return err
		}
		for _, draft := range using {
			if err := writeDraftMediaWithin(ctx, tx, company, actorUserID, draft.ID, draft.draftState, nil); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE media_generation_jobs SET asset_id = NULL, asset_deleted_at = now() WHERE company_id = $1 AND asset_id = $2`,
			company.String(), assetID); err != nil {
			return err
		}
		change = Change{Outcome: "deleted", StorageKey: key}
		_, err = tx.Exec(ctx, `DELETE FROM media_assets WHERE company_id = $1 AND id = $2`, company.String(), assetID)
		return err
	})
	return change, err
}

// lockAndSort locks every draft using the asset, and names those whose
// status keeps it as it is.
func lockAndSort(ctx context.Context, tx database.Tx, company tenant.CompanyID, assetID string, keepingStatuses []string) ([]usingDraft, []DraftUsing, error) {
	using, err := lockDraftsUsingWithin(ctx, tx, company, assetID)
	if err != nil {
		return nil, nil, err
	}
	var keeping []DraftUsing
	for _, draft := range using {
		if drafts.In(keepingStatuses, draft.Status) {
			keeping = append(keeping, DraftUsing{AssetID: assetID, DraftID: draft.ID, Topic: draft.Topic, Status: draft.Status})
		}
	}
	return using, keeping, nil
}

// DraftsUsingWords is "the draft “Lunch menu” (Approved) uses", or "the
// drafts “A” (Approved), “B” (Scheduled), “C” (Published) and 2 more use":
// the library's refusals name the drafts they are about.
func DraftsUsingWords(using []DraftUsing) string {
	var named []string
	for _, draft := range using[:min(3, len(using))] {
		named = append(named, "“"+draft.Topic+"” ("+drafts.StatusLabels[draft.Status]+")")
	}
	if len(using) == 1 {
		return "the draft " + named[0] + " uses"
	}
	more := ""
	if len(using) > 3 {
		more = " and " + strconv.Itoa(len(using)-3) + " more"
	}
	return "the drafts " + strings.Join(named, ", ") + more + " use"
}
