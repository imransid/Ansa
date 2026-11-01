package publishing

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Every waiting post and every one needing attention are listed up to this
// many (a company has a few dozen at most); the failed, published and
// canceled ones, the newest this many.
const (
	openJobsShown     = 200
	finishedJobsShown = 50
)

// QueuePage is what the Co-Founder's queue page shows (the old
// getQueuePageForSession): the company's posts by status with their counts,
// its auto-publish rules, the current plan's content pillars (for a new
// rule), and the newest activity. Everyone in the company reads it; only
// owners act (the page hides what core refuses anyway).
type QueuePage struct {
	Counts         map[string]int     `json:"counts"`
	Waiting        []JobListItem      `json:"waiting"`
	NeedsAttention []JobListItem      `json:"needsAttention"`
	Failed         []JobListItem      `json:"failed"`
	Published      []JobListItem      `json:"published"`
	Canceled       []JobListItem      `json:"canceled"`
	Rules          []RuleListItem     `json:"rules"`
	Pillars        []string           `json:"pillars"`
	Activity       []ActivityListItem `json:"activity"`
	CanManage      bool               `json:"canManage"`
	// A post is going out, or due and about to: the page refreshes itself.
	IsBusy bool `json:"isBusy"`
}

// ReadQueuePage reads the queue page of one company. canManage: the person
// is an owner (from the session). Reading writes nothing.
func ReadQueuePage(ctx context.Context, pool *database.Pool, company tenant.CompanyID, canManage bool, now time.Time) (*QueuePage, error) {
	page := &QueuePage{CanManage: canManage}
	var err error
	if page.Counts, err = countJobsPerStatus(ctx, pool, company); err != nil {
		return nil, err
	}
	lists := []struct {
		into      *[]JobListItem
		statement string
		statuses  []string
		limit     int
	}{
		{&page.Waiting, waitingJobs, []string{"publishing", "queued"}, openJobsShown},
		{&page.NeedsAttention, changedJobs, []string{"needs_attention"}, openJobsShown},
		{&page.Failed, changedJobs, []string{"failed"}, finishedJobsShown},
		{&page.Published, changedJobs, []string{"published"}, finishedJobsShown},
		{&page.Canceled, changedJobs, []string{"canceled"}, finishedJobsShown},
	}
	for _, list := range lists {
		if *list.into, err = listJobs(ctx, pool, list.statement, company, list.statuses, list.limit); err != nil {
			return nil, err
		}
	}
	if page.Rules, err = listRules(ctx, pool, company); err != nil {
		return nil, err
	}
	if page.Pillars, err = CurrentPlanPillars(ctx, pool, company); err != nil {
		return nil, err
	}
	if page.Activity, err = listActivity(ctx, pool, company, ""); err != nil {
		return nil, err
	}
	for _, job := range page.Waiting {
		if job.Status == "publishing" || isJustDue(job.RunAfter, now) {
			page.IsBusy = true
		}
	}
	return page, nil
}

// RuleListItem is one auto-publish rule as the queue page lists it.
type RuleListItem struct {
	ID       string `json:"id"`
	Platform string `json:"platform"`
	// "" = any pillar.
	Pillar        string     `json:"pillar"`
	Enabled       bool       `json:"enabled"`
	CreatedAt     time.Time  `json:"createdAt"`
	CreatedByName *string    `json:"createdByName"`
	EnabledAt     *time.Time `json:"enabledAt"`
	EnabledByName *string    `json:"enabledByName"`
}

// listRules is one company's rules, by platform and pillar ("any pillar" first).
func listRules(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]RuleListItem, error) {
	const statement = `
		SELECT autopublish_rules.id, autopublish_rules.platform, autopublish_rules.pillar, autopublish_rules.enabled, autopublish_rules.created_at,
			creator.name, autopublish_rules.enabled_at, enabler.name
		FROM autopublish_rules
		LEFT JOIN users AS creator ON creator.company_id = autopublish_rules.company_id AND creator.id = autopublish_rules.created_by_user_id
		LEFT JOIN users AS enabler ON enabler.company_id = autopublish_rules.company_id AND enabler.id = autopublish_rules.enabled_by_user_id
		WHERE autopublish_rules.company_id = $1
		ORDER BY autopublish_rules.platform, autopublish_rules.pillar, autopublish_rules.id`
	rows, err := pool.Query(ctx, statement, company.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	rules := []RuleListItem{}
	for rows.Next() {
		var rule RuleListItem
		if err := rows.Scan(&rule.ID, &rule.Platform, &rule.Pillar, &rule.Enabled, &rule.CreatedAt, &rule.CreatedByName, &rule.EnabledAt, &rule.EnabledByName); err != nil {
			return nil, err
		}
		rules = append(rules, rule)
	}
	return rules, rows.Err()
}
