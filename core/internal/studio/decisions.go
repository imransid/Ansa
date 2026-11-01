package studio

import (
	"context"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/publishing"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// What happens to a draft besides its content: owners approve and reject;
// anyone active in the company archives and restores. Each is recorded in
// the activity log, and a rejection or an archive cancels the draft's
// waiting posts, in the same transaction.

// Approval outcomes besides the shared ones: Blocked (a platform rule or a
// word to avoid, with the issues), ClaimsNotChecked (a claim isn't backed
// and "I checked these claims" wasn't ticked).
const (
	Approved         = "approved"
	Blocked          = "blocked"
	ClaimsNotChecked = "claims-not-checked"
)

// ApproveOutcome is an approval's outcome; Issues only when Blocked.
type ApproveOutcome struct {
	Outcome string
	Issues  []contentrules.Issue
}

// Approve approves one draft as the version the owner read. WHY the rules
// and the claims are checked here, on the row as stored and the facts as
// confirmed now, inside the transaction that writes: the page's own check
// could be minutes old, and the approval must be of exactly this text. An
// approval by someone made a member or removed since lets nothing go out,
// so another owner may approve the same version again. A draft the queue
// has keeps the status its posts give it.
func Approve(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, draftID string, version int, claimsChecked bool) (ApproveOutcome, error) {
	var result ApproveOutcome
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		draft, refusal, err := lockForDecision(ctx, tx, company, actorUserID, draftID, true)
		if err != nil || refusal != "" {
			result.Outcome = refusal
			return err
		}
		replacing := draft.ApprovedByUserID != nil && draft.ApprovedVersion != nil && *draft.ApprovedVersion == draft.Version
		if replacing {
			// The approver's row locked FOR SHARE too: a demotion saved now is waited for, then seen.
			approverRole, err := team.RoleWithin(ctx, tx, company, *draft.ApprovedByUserID)
			if err != nil {
				return err
			}
			if approverRole == "owner" {
				result.Outcome = Unchanged
				if draft.Version != version {
					result.Outcome = Stale
				}
				return nil
			}
		}
		switch {
		case !replacing && !drafts.In(drafts.ApprovableStatuses, draft.Status):
			result.Outcome = WrongStatus
			return nil
		case draft.Version != version:
			result.Outcome = Stale
			return nil
		}
		result, err = approveChecked(ctx, tx, company, actorUserID, draftID, draft, claimsChecked)
		return err
	})
	return result, err
}

// approveChecked reviews the locked draft against the facts now and, when
// nothing stops it, writes the approval of its version.
func approveChecked(ctx context.Context, tx database.Tx, company tenant.CompanyID, actorUserID, draftID string, draft *drafts.LockedContent, claimsChecked bool) (ApproveOutcome, error) {
	media, err := attachedMedia(ctx, tx, company, draft.MediaAssetID)
	if err != nil {
		return ApproveOutcome{}, err
	}
	facts, err := drafts.ConfirmedFacts(ctx, tx, company)
	if err != nil {
		return ApproveOutcome{}, err
	}
	review := drafts.ReviewDraft(drafts.ForReview{Platform: draft.Platform, Format: draft.Format, Fields: draft.Fields, Version: draft.Version,
		GeneratedVersion: draft.GeneratedVersion, Claims: draft.Claims, FactsUsed: draft.FactsUsed, Media: media}, facts)
	if len(review.BlockingIssues) > 0 {
		return ApproveOutcome{Outcome: Blocked, Issues: review.BlockingIssues}, nil
	}
	if review.AcknowledgmentNeeded && !claimsChecked {
		return ApproveOutcome{Outcome: ClaimsNotChecked}, nil
	}
	status := "approved"
	if drafts.In(drafts.QueueStatuses, draft.Status) {
		status = draft.Status
	}
	const update = `
		UPDATE content_drafts SET status = $4, approved_by_user_id = $5, approved_at = now(), approved_version = $3,
			claims_acknowledged_by_user_id = CASE WHEN $6 THEN $5 ELSE NULL END, claims_acknowledged_at = CASE WHEN $6 THEN now() ELSE NULL END,
			rejected_by_user_id = NULL, rejected_at = NULL, rejection_note = NULL
		WHERE company_id = $1 AND id = $2 AND version = $3`
	if _, err := tx.Exec(ctx, update, company.String(), draftID, draft.Version, status, actorUserID, review.AcknowledgmentNeeded); err != nil {
		return ApproveOutcome{}, err
	}
	err = publishing.RecordActivityWithin(ctx, tx, company, publishing.Activity{Action: "draft_approved", ActorUserID: actorUserID, DraftID: draftID})
	return ApproveOutcome{Outcome: Approved}, err
}

// Reject rejects one draft as the version the owner read, with their note
// (nil: none). An approved draft loses its approval.
func Reject(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, draftID string, version int, note *string) (string, error) {
	var outcome string
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		draft, refusal, err := lockForDecision(ctx, tx, company, actorUserID, draftID, true)
		switch {
		case err != nil || refusal != "":
			outcome = refusal
			return err
		case draft.Status == "rejected" && draft.Version == version:
			outcome = Unchanged
			return nil
		case draft.Status == "rejected":
			outcome = Stale
			return nil
		case !drafts.In(drafts.RejectableStatuses, draft.Status):
			outcome = WrongStatus
			return nil
		case draft.Version != version:
			outcome = Stale
			return nil
		}
		const update = `
			UPDATE content_drafts SET status = 'rejected', rejected_by_user_id = $4, rejected_at = now(), rejection_note = $5,
				approved_by_user_id = NULL, approved_at = NULL, approved_version = NULL, claims_acknowledged_by_user_id = NULL, claims_acknowledged_at = NULL
			WHERE company_id = $1 AND id = $2 AND version = $3`
		if _, err := tx.Exec(ctx, update, company.String(), draftID, version, actorUserID, note); err != nil {
			return err
		}
		outcome = Changed
		if err := publishing.RecordActivityWithin(ctx, tx, company, publishing.Activity{Action: "draft_rejected", ActorUserID: actorUserID, DraftID: draftID}); err != nil {
			return err
		}
		return publishing.CancelQueuedOfDraftWithin(ctx, tx, company, actorUserID, draftID, "draft_rejected")
	})
	return outcome, err
}
