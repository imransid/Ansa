package publishing

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// JobListItem is one post as the queue and a draft's page list it (the old
// PublishJobListItem). A post cut off while sending shows as needing
// attention ("interrupted") at once: the pages compute it, nothing is
// written by reading (a person's Mark or Retry hands it over first).
type JobListItem struct {
	ID              string     `json:"id"`
	Status          string     `json:"status"`
	ScheduledFor    time.Time  `json:"scheduledFor"`
	RunAfter        time.Time  `json:"runAfter"`
	Attempts        int        `json:"attempts"`
	LastError       *string    `json:"lastError"`
	PublishedAt     *time.Time `json:"publishedAt"`
	ExternalURL     *string    `json:"externalUrl"`
	ApprovalMode    string     `json:"approvalMode"`
	ApprovedVersion int        `json:"approvedVersion"`
	UpdatedAt       time.Time  `json:"updatedAt"`
	DraftID         string     `json:"draftId"`
	DraftTopic      string     `json:"draftTopic"`
	DraftPlatform   string     `json:"draftPlatform"`
	DraftFormat     string     `json:"draftFormat"`
	ConnectionID    string     `json:"connectionId"`
	// nil: the account row is gone (never, by the foreign key; kept as the old type).
	ConnectionName      *string `json:"connectionName"`
	ConnectionStatus    *string `json:"connectionStatus"`
	ConnectionIsStandIn *bool   `json:"connectionIsStandIn"`
	CreatedByName       *string `json:"createdByName"`
	CanceledByName      *string `json:"canceledByName"`
	// A rule's post: whether the rule is still on (nil: an owner's approval).
	RuleEnabled *bool `json:"ruleEnabled"`
	// A failed post whose account has the draft on its way, out or waiting
	// for a check again (scheduled or tried again there since): it no longer
	// counts for the draft, and can't be tried again.
	ScheduledAgain bool `json:"scheduledAgain"`
}

// listedJobs is every job of one company ($1) as the pages show it ($2: how
// old a claim is when it counts as cut off). Every join matches the
// company too, so nothing of another company can show up. The lists below
// wrap it, so their own conditions read the shown status.
const listedJobs = `
	SELECT publish_jobs.id,
		CASE WHEN publish_jobs.status = 'publishing' AND publish_jobs.claimed_at < now() - make_interval(secs => $2) THEN 'needs_attention' ELSE publish_jobs.status END AS status,
		publish_jobs.scheduled_for, publish_jobs.run_after, publish_jobs.attempts,
		CASE WHEN publish_jobs.status = 'publishing' AND publish_jobs.claimed_at < now() - make_interval(secs => $2) THEN 'interrupted' ELSE publish_jobs.last_error END AS last_error,
		publish_jobs.published_at, publish_jobs.external_url, publish_jobs.approval_mode, publish_jobs.approved_version, publish_jobs.updated_at,
		publish_jobs.draft_id, content_drafts.topic, content_drafts.platform, content_drafts.format,
		publish_jobs.connection_id, social_connections.display_name, social_connections.status AS connection_status, social_connections.is_stand_in,
		creator.name AS creator_name, canceler.name AS canceler_name, autopublish_rules.enabled AS rule_enabled,
		(publish_jobs.status = 'failed' AND live_sibling.id IS NOT NULL) AS scheduled_again,
		publish_jobs.created_at
	FROM publish_jobs
	JOIN content_drafts ON content_drafts.company_id = publish_jobs.company_id AND content_drafts.id = publish_jobs.draft_id
	LEFT JOIN social_connections ON social_connections.company_id = publish_jobs.company_id AND social_connections.id = publish_jobs.connection_id
	LEFT JOIN users AS creator ON creator.company_id = publish_jobs.company_id AND creator.id = publish_jobs.created_by_user_id
	LEFT JOIN users AS canceler ON canceler.company_id = publish_jobs.company_id AND canceler.id = publish_jobs.canceled_by_user_id
	LEFT JOIN autopublish_rules ON autopublish_rules.company_id = publish_jobs.company_id AND autopublish_rules.id = publish_jobs.autopublish_rule_id
	LEFT JOIN publish_jobs AS live_sibling ON live_sibling.company_id = publish_jobs.company_id AND live_sibling.draft_id = publish_jobs.draft_id
		AND live_sibling.connection_id = publish_jobs.connection_id AND live_sibling.id <> publish_jobs.id
		AND live_sibling.status IN ('queued', 'publishing', 'published', 'needs_attention')
	WHERE publish_jobs.company_id = $1`

// One company's waiting posts (queued, or going out), by when they are due.
const waitingJobs = `SELECT * FROM (` + listedJobs + `) AS listed
	WHERE listed.status = ANY($3::text[]) ORDER BY listed.run_after, listed.id LIMIT $4`

// One company's posts of these statuses, the newest change first.
const changedJobs = `SELECT * FROM (` + listedJobs + `) AS listed
	WHERE listed.status = ANY($3::text[]) ORDER BY listed.updated_at DESC, listed.id DESC LIMIT $4`

// One draft's posts, the newest first.
const jobsOfDraft = `SELECT * FROM (` + listedJobs + `) AS listed
	WHERE listed.draft_id::text = $3 ORDER BY listed.created_at DESC, listed.id DESC LIMIT $4`

// listJobs runs one of the lists above for one company: filter is its $3.
func listJobs(ctx context.Context, pool *database.Pool, statement string, company tenant.CompanyID, filter any, limit int) ([]JobListItem, error) {
	rows, err := pool.Query(ctx, statement, company.String(), staleAfter.Seconds(), filter, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	jobs := []JobListItem{}
	for rows.Next() {
		job, err := scanJob(rows)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}

func scanJob(rows pgx.Rows) (JobListItem, error) {
	var job JobListItem
	var createdAt time.Time
	err := rows.Scan(&job.ID, &job.Status, &job.ScheduledFor, &job.RunAfter, &job.Attempts, &job.LastError, &job.PublishedAt, &job.ExternalURL,
		&job.ApprovalMode, &job.ApprovedVersion, &job.UpdatedAt, &job.DraftID, &job.DraftTopic, &job.DraftPlatform, &job.DraftFormat,
		&job.ConnectionID, &job.ConnectionName, &job.ConnectionStatus, &job.ConnectionIsStandIn, &job.CreatedByName, &job.CanceledByName,
		&job.RuleEnabled, &job.ScheduledAgain, &createdAt)
	return job, err
}

// countJobsPerStatus is how many posts of each status one company has, as
// the pages show them (one cut off while sending needs attention).
func countJobsPerStatus(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (map[string]int, error) {
	const statement = `
		SELECT status, count(*), count(*) FILTER (WHERE status = 'publishing' AND claimed_at < now() - make_interval(secs => $2))
		FROM publish_jobs WHERE company_id = $1 GROUP BY status`
	counts := map[string]int{"queued": 0, "publishing": 0, "published": 0, "failed": 0, "canceled": 0, "needs_attention": 0}
	rows, err := pool.Query(ctx, statement, company.String(), staleAfter.Seconds())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var status string
		var count, cutOff int
		if err := rows.Scan(&status, &count, &cutOff); err != nil {
			return nil, err
		}
		counts[status] += count - cutOff
		counts["needs_attention"] += cutOff
	}
	return counts, rows.Err()
}

// A post due this recently is being picked up by the run after the answer
// that made it due (scheduled for now, sent now, tried again): the page
// refreshes itself while it goes out. One due longer ago waits for the
// scheduler's next round, and the page doesn't wait with it.
const justDue = 2 * time.Minute

func isJustDue(runAfter, now time.Time) bool {
	dueFor := now.Sub(runAfter)
	return dueFor >= 0 && dueFor <= justDue
}
