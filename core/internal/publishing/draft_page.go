package publishing

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// The most posts of one draft its page lists (one per account, and the
// failed or canceled ones before them).
const draftJobsShown = 100

// DraftPublishing is what a draft's page shows about publishing it (the
// old getDraftPublishingForSession): its posts, the accounts of its
// platform it could go to, whether ansa publishes its format, the
// auto-publish rule that would cover it, and its own activity. Scheduling
// decides everything again, locked (Schedule).
type DraftPublishing struct {
	Jobs     []JobListItem   `json:"jobs"`
	Accounts []AccountChoice `json:"accounts"`
	// ansa publishes this format to this platform (contentrules.PublishedFormats).
	FormatPublishable bool `json:"formatPublishable"`
	// An enabled rule that would cover it (by its platform and pillar); nil: none.
	CoveringRule *CoveringRule      `json:"coveringRule"`
	Activity     []ActivityListItem `json:"activity"`
	CanManage    bool               `json:"canManage"`
	// A post of it is going out, or due and about to: the page refreshes itself.
	IsBusy bool `json:"isBusy"`
}

// AccountChoice is one of the company's accounts on the draft's platform
// (not disconnected) the owner may pick.
type AccountChoice struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	IsStandIn   bool   `json:"isStandIn"`
	Status      string `json:"status"`
	// The draft is on its way, out, or maybe out there already.
	HasLiveJob bool `json:"hasLiveJob"`
}

// CoveringRule names the rule that would send the draft without an approval.
type CoveringRule struct {
	Platform string `json:"platform"`
	Pillar   string `json:"pillar"`
}

// ReadDraftPublishing reads one draft's Publish section of one company:
// nil when the company has no such draft. canManage: the person is an owner.
func ReadDraftPublishing(ctx context.Context, pool *database.Pool, company tenant.CompanyID, draftID string, canManage bool, now time.Time) (*DraftPublishing, error) {
	var platform, format, pillar string
	const draft = `SELECT platform, format, pillar FROM content_drafts WHERE company_id = $1 AND id::text = $2`
	err := pool.QueryRow(ctx, draft, company.String(), draftID).Scan(&platform, &format, &pillar)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	section := &DraftPublishing{FormatPublishable: publishes(platform, format), CanManage: canManage}
	if section.Jobs, err = listJobs(ctx, pool, jobsOfDraft, company, draftID, draftJobsShown); err != nil {
		return nil, err
	}
	if section.Accounts, err = accountChoices(ctx, pool, company, platform, section.Jobs); err != nil {
		return nil, err
	}
	if section.CoveringRule, err = coveringRule(ctx, pool, company, platform, pillar); err != nil {
		return nil, err
	}
	if section.Activity, err = listActivity(ctx, pool, company, draftID); err != nil {
		return nil, err
	}
	for _, job := range section.Jobs {
		if job.Status == "publishing" || (job.Status == "queued" && isJustDue(job.RunAfter, now)) {
			section.IsBusy = true
		}
	}
	return section, nil
}

// accountChoices are the company's accounts of one platform that aren't
// disconnected, by name, each saying whether the draft has a live post there.
func accountChoices(ctx context.Context, pool *database.Pool, company tenant.CompanyID, platform string, jobs []JobListItem) ([]AccountChoice, error) {
	const statement = `
		SELECT id, display_name, is_stand_in, status FROM social_connections
		WHERE company_id = $1 AND platform = $2 AND status <> 'disconnected'
		ORDER BY display_name, id`
	rows, err := pool.Query(ctx, statement, company.String(), platform)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	live := map[string]bool{}
	for _, job := range jobs {
		live[job.ConnectionID] = live[job.ConnectionID] || liveStatuses[job.Status]
	}
	accounts := []AccountChoice{}
	for rows.Next() {
		var account AccountChoice
		if err := rows.Scan(&account.ID, &account.DisplayName, &account.IsStandIn, &account.Status); err != nil {
			return nil, err
		}
		account.HasLiveJob = live[account.ID]
		accounts = append(accounts, account)
	}
	return accounts, rows.Err()
}

// coveringRule is the enabled rule of the company that would cover a draft
// (its own pillar first, then any pillar), for the page to offer "without
// an approval"; scheduling decides again, locked (lockRuleCoveringWithin).
func coveringRule(ctx context.Context, pool *database.Pool, company tenant.CompanyID, platform, pillar string) (*CoveringRule, error) {
	const statement = `
		SELECT platform, pillar FROM autopublish_rules
		WHERE company_id = $1 AND platform = $2 AND enabled AND (pillar = '' OR pillar = $3)
		ORDER BY pillar = '' LIMIT 1`
	var rule CoveringRule
	err := pool.QueryRow(ctx, statement, company.String(), platform, pillar).Scan(&rule.Platform, &rule.Pillar)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rule, nil
}
