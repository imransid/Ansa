package analytics

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// world is one test company with an owner, its accounts, and posts that
// went out the way the queue leaves them (rows written directly: the queue
// itself has its own tests).
type world struct {
	t        *testing.T
	pool     *database.Pool
	company  tenant.CompanyID
	owner    string
	accounts map[string]string
}

func newWorld(t *testing.T, pool *database.Pool) *world {
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	return &world{t: t, pool: pool, company: company, owner: database.TestOwner(t, pool, companyID), accounts: map[string]string{}}
}

func (w *world) must(statement string, args ...any) {
	w.t.Helper()
	if _, err := w.pool.Exec(context.Background(), statement, args...); err != nil {
		w.t.Fatalf("setup: %v", err)
	}
}

var accountKinds = map[string]string{"linkedin": "member", "facebook": "page", "x": "account", "youtube": "channel"}

// account is the company's account on the platform: the development
// stand-in, or a "real" one (any other id).
func (w *world) account(platform string, standIn bool) string {
	key := fmt.Sprintf("%s:%v", platform, standIn)
	if id, has := w.accounts[key]; has {
		return id
	}
	externalID := "dev:stand-in"
	if !standIn {
		externalID = "real-" + platform
	}
	var id string
	err := w.pool.QueryRow(context.Background(), `
		INSERT INTO social_connections (company_id, platform, external_account_id, display_name, account_kind, access_token_encrypted, connected_by_user_id, is_stand_in)
		VALUES ($1, $2, $3, 'Bluebird Bakery', $4, 'placeholder', $5, $6) RETURNING id`,
		w.company.String(), platform, externalID, accountKinds[platform], w.owner, standIn).Scan(&id)
	if err != nil {
		w.t.Fatalf("account: %v", err)
	}
	w.accounts[key] = id
	return id
}

// post is a text post that went out `ago` (a Postgres interval) to the
// platform's stand-in account: its job's id.
func (w *world) post(platform, topic, pillar, ago string) string {
	return w.job(platform, topic, pillar, "published", ago, true)
}

// job is a post of any status on the platform's account: its job's id.
func (w *world) job(platform, topic, pillar, status, ago string, standIn bool) string {
	ctx := context.Background()
	format := "post"
	if platform == "youtube" {
		format = "video"
	}
	var draftID, jobID string
	err := w.pool.QueryRow(ctx, `INSERT INTO content_drafts (company_id, platform, format, topic, pillar, body, status, created_by_user_id, updated_by_user_id)
		VALUES ($1, $2, $3, $4, $5, 'Fresh from the oven', 'published', $6, $6) RETURNING id`,
		w.company.String(), platform, format, topic, pillar, w.owner).Scan(&draftID)
	if err != nil {
		w.t.Fatalf("draft: %v", err)
	}
	columns := map[string]string{
		"published":  `published_at, external_post_id, last_error, claimed_at) VALUES ($1, $2, $3, now(), now(), 'published', 'owner', 1, $4, 1, now() - $5::interval, 'dev-' || gen_random_uuid(), NULL, NULL)`,
		"failed":     `published_at, external_post_id, last_error, claimed_at) VALUES ($1, $2, $3, now(), now(), 'failed', 'owner', 1, $4, 1, NULL, NULL, 'invalid_request', NULL)`,
		"publishing": `published_at, external_post_id, last_error, claimed_at) VALUES ($1, $2, $3, now(), now(), 'publishing', 'owner', 1, $4, 1, NULL, NULL, NULL, now() - $5::interval)`,
	}
	statement := `INSERT INTO publish_jobs (company_id, draft_id, connection_id, scheduled_for, run_after, status, approval_mode, approved_version, created_by_user_id, attempts, ` + columns[status] + ` RETURNING id`
	args := []any{w.company.String(), draftID, w.account(platform, standIn), w.owner}
	if strings.Contains(columns[status], "$5") {
		args = append(args, ago)
	}
	if err := w.pool.QueryRow(ctx, statement, args...).Scan(&jobID); err != nil {
		w.t.Fatalf("job: %v", err)
	}
	return jobID
}

// numbers saves a snapshot of a post, collected `ago`, as "name=value" pairs.
func (w *world) numbers(jobID, source, ago string, values map[string]int64) {
	columns := map[string]*int64{}
	for _, column := range MetricColumns {
		if value, has := values[column]; has {
			columns[column] = &value
		}
	}
	w.must(`INSERT INTO post_metrics (company_id, publish_job_id, collected_at, views, reach, reactions, comments, shares, clicks, video_views, source)
		VALUES ($1, $2, now() - $3::interval, $4, $5, $6, $7, $8, $9, $10, $11)`, w.company.String(), jobID, ago,
		columns["views"], columns["reach"], columns["reactions"], columns["comments"], columns["shares"], columns["clicks"], columns["video_views"], source)
}
