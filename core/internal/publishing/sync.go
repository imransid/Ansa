package publishing

import (
	"context"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Job statuses that keep a draft's place on an account (the partial unique
// index allows one of these per draft and account).
var liveStatuses = map[string]bool{"queued": true, "publishing": true, "published": true, "needs_attention": true}

// JobOfDraft is one of a draft's jobs: the account it goes to, and how it stands.
type JobOfDraft struct {
	ConnectionID, Status string
}

// DraftStatusFromJobs is what a draft's jobs make it (the old
// lib/publishing/draft-status.ts): scheduled while one is on its way;
// failed while one failed or needs a person and none is on its way;
// published once every one went out. With none left (all canceled):
// approved while its approval of this version holds, else a draft. A failed
// job whose account has a live job of the draft (tried again there since)
// doesn't count.
func DraftStatusFromJobs(jobs []JobOfDraft, approvalHolds bool) string {
	var counted []string
	for _, job := range jobs {
		if job.Status != "canceled" && !replacedFailure(job, jobs) {
			counted = append(counted, job.Status)
		}
	}
	has := func(statuses ...string) bool {
		for _, status := range counted {
			for _, wanted := range statuses {
				if status == wanted {
					return true
				}
			}
		}
		return false
	}
	switch {
	case has("queued", "publishing"):
		return "scheduled"
	case has("failed", "needs_attention"):
		return "failed"
	case len(counted) > 0:
		return "published"
	case approvalHolds:
		return "approved"
	}
	return "draft"
}

func replacedFailure(job JobOfDraft, jobs []JobOfDraft) bool {
	if job.Status != "failed" {
		return false
	}
	for _, other := range jobs {
		if other.ConnectionID == job.ConnectionID && liveStatuses[other.Status] {
			return true
		}
	}
	return false
}

// syncDraftWithin sets a draft's status from its jobs while the queue has
// it (scheduled, published or failed), inside the transaction that changed
// a job, with the draft's row already locked. A status a person chose since
// (a draft again after an edit, rejected, archived) stays.
func syncDraftWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, draftID string) error {
	var status string
	var version int
	var approvedBy *string
	var approvedVersion *int
	const read = `SELECT status, version, approved_by_user_id, approved_version FROM content_drafts WHERE company_id = $1 AND id = $2`
	if err := tx.QueryRow(ctx, read, company.String(), draftID).Scan(&status, &version, &approvedBy, &approvedVersion); err != nil {
		return err
	}
	if status != "scheduled" && status != "published" && status != "failed" {
		return nil
	}
	rows, err := tx.Query(ctx, `SELECT connection_id, status FROM publish_jobs WHERE company_id = $1 AND draft_id = $2`, company.String(), draftID)
	if err != nil {
		return err
	}
	var jobs []JobOfDraft
	for rows.Next() {
		var job JobOfDraft
		if err := rows.Scan(&job.ConnectionID, &job.Status); err != nil {
			rows.Close()
			return err
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	holds := approvedBy != nil && approvedVersion != nil && *approvedVersion == version
	next := DraftStatusFromJobs(jobs, holds)
	if next == status {
		return nil
	}
	_, err = tx.Exec(ctx, `UPDATE content_drafts SET status = $3 WHERE company_id = $1 AND id = $2`, company.String(), draftID, next)
	return err
}
