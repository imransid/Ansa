package analytics

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// ProblemPost is one post that failed or needs a person's check, in the
// shape the queue's job list shows (the old PublishJobListItem). A post
// still "publishing" 10+ minutes after its claim was cut off while sending:
// it shows as needing attention ("interrupted") at once.
type ProblemPost struct {
	ID                  string     `json:"id"`
	Status              string     `json:"status"`
	ScheduledFor        time.Time  `json:"scheduledFor"`
	RunAfter            time.Time  `json:"runAfter"`
	Attempts            int        `json:"attempts"`
	LastError           *string    `json:"lastError"`
	PublishedAt         *time.Time `json:"publishedAt"`
	ExternalURL         *string    `json:"externalUrl"`
	ApprovalMode        string     `json:"approvalMode"`
	ApprovedVersion     int        `json:"approvedVersion"`
	UpdatedAt           time.Time  `json:"updatedAt"`
	DraftID             string     `json:"draftId"`
	DraftTopic          string     `json:"draftTopic"`
	DraftPlatform       string     `json:"draftPlatform"`
	DraftFormat         string     `json:"draftFormat"`
	ConnectionID        string     `json:"connectionId"`
	ConnectionName      *string    `json:"connectionName"`
	ConnectionStatus    *string    `json:"connectionStatus"`
	ConnectionIsStandIn *bool      `json:"connectionIsStandIn"`
	CreatedByName       *string    `json:"createdByName"`
	CanceledByName      *string    `json:"canceledByName"`
	// For a post under an auto-publish rule: whether the rule is still on.
	RuleEnabled *bool `json:"ruleEnabled"`
	// A failed post whose account has the draft on its way, out or waiting
	// for a check again: it no longer counts, and can't be tried again.
	ScheduledAgain bool `json:"scheduledAgain"`
}

// publishingProblems lists one company's posts that failed or need
// attention (a cut-off one too) whose last change was in the period,
// newest first (the old getPublishingProblemsBetween). The 10 minutes are
// the publishing queue's: a claim older than that was cut off.
func publishingProblems(ctx context.Context, pool *database.Pool, company tenant.CompanyID, from, to time.Time, limit int) ([]ProblemPost, error) {
	const statement = `
		SELECT jobs.id,
			CASE WHEN jobs.status = 'publishing' AND jobs.claimed_at < now() - make_interval(mins => 10) THEN 'needs_attention' ELSE jobs.status END,
			jobs.scheduled_for, jobs.run_after, jobs.attempts,
			CASE WHEN jobs.status = 'publishing' AND jobs.claimed_at < now() - make_interval(mins => 10) THEN 'interrupted' ELSE jobs.last_error END,
			jobs.published_at, jobs.external_url, jobs.approval_mode, jobs.approved_version, jobs.updated_at,
			jobs.draft_id, drafts.topic, drafts.platform, drafts.format,
			jobs.connection_id, accounts.display_name, accounts.status, accounts.is_stand_in,
			creator.name, canceler.name, rules.enabled, (jobs.status = 'failed' AND live.id IS NOT NULL)
		FROM publish_jobs AS jobs
		JOIN content_drafts AS drafts ON drafts.company_id = jobs.company_id AND drafts.id = jobs.draft_id
		LEFT JOIN social_connections AS accounts ON accounts.company_id = jobs.company_id AND accounts.id = jobs.connection_id
		LEFT JOIN users AS creator ON creator.company_id = jobs.company_id AND creator.id = jobs.created_by_user_id
		LEFT JOIN users AS canceler ON canceler.company_id = jobs.company_id AND canceler.id = jobs.canceled_by_user_id
		LEFT JOIN autopublish_rules AS rules ON rules.company_id = jobs.company_id AND rules.id = jobs.autopublish_rule_id
		LEFT JOIN publish_jobs AS live ON live.company_id = jobs.company_id AND live.draft_id = jobs.draft_id
			AND live.connection_id = jobs.connection_id AND live.id <> jobs.id
			AND live.status IN ('queued', 'publishing', 'published', 'needs_attention')
		WHERE jobs.company_id = $1
			AND (jobs.status IN ('failed', 'needs_attention') OR (jobs.status = 'publishing' AND jobs.claimed_at < now() - make_interval(mins => 10)))
			AND jobs.updated_at >= $2 AND jobs.updated_at < $3
		ORDER BY jobs.updated_at DESC, jobs.id DESC
		LIMIT $4`
	rows, err := pool.Query(ctx, statement, company.String(), from, to, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	problems := []ProblemPost{}
	for rows.Next() {
		var p ProblemPost
		err := rows.Scan(&p.ID, &p.Status, &p.ScheduledFor, &p.RunAfter, &p.Attempts, &p.LastError,
			&p.PublishedAt, &p.ExternalURL, &p.ApprovalMode, &p.ApprovedVersion, &p.UpdatedAt,
			&p.DraftID, &p.DraftTopic, &p.DraftPlatform, &p.DraftFormat,
			&p.ConnectionID, &p.ConnectionName, &p.ConnectionStatus, &p.ConnectionIsStandIn,
			&p.CreatedByName, &p.CanceledByName, &p.RuleEnabled, &p.ScheduledAgain)
		if err != nil {
			return nil, err
		}
		problems = append(problems, p)
	}
	return problems, rows.Err()
}
