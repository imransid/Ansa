package calendar

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/profile"
	"ansa/core/internal/strategy"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// CurrentPlan is one company's newest marketing plan and its version; nil
// when there is none, or none this code can read.
func CurrentPlan(ctx context.Context, q profile.Querier, company tenant.CompanyID) (*strategy.Plan, int, error) {
	stored, err := strategy.ReadVersion(ctx, q, company, 0)
	if err != nil || stored == nil {
		return nil, 0, err
	}
	var used []strategy.UsedFact
	sent := map[string]bool{}
	if json.Unmarshal(stored.FactsUsed, &used) == nil {
		for _, fact := range used {
			sent[fact.Topic] = true
		}
	}
	plan, ok := strategy.ReadPlan(stored.Plan, sent)
	if !ok {
		return nil, 0, nil
	}
	return plan, stored.Version, nil
}

// Planned is one draft planned for a day, or one post on its way or out.
type Planned struct {
	ID          string
	At          time.Time
	DraftID     string
	Topic       string
	Platform    string
	Format      string
	Status      string
	AccountName *string
}

// PlannedDraftsBetween are one company's drafts planned between two
// moments that aren't on their way (scheduled, published or failed ones
// show as their posts) and aren't archived: the calendar's ideas and drafts.
func PlannedDraftsBetween(ctx context.Context, q profile.Querier, company tenant.CompanyID, from, to time.Time, limit int) ([]Planned, error) {
	const statement = `
		SELECT id, planned_for, id, topic, platform, format, status, NULL::text FROM content_drafts
		WHERE company_id = $1 AND status NOT IN ('scheduled', 'published', 'failed', 'archived') AND planned_for >= $2 AND planned_for < $3
		ORDER BY planned_for, id LIMIT $4`
	return collectPlanned(q.Query(ctx, statement, company.String(), from, to, limit))
}

// PostsBetween are one company's posts (but canceled ones) due between two
// moments, each at when it went out or is due, its status as the pages
// show it (one cut off while sending needs attention).
func PostsBetween(ctx context.Context, q profile.Querier, company tenant.CompanyID, from, to time.Time, limit int) ([]Planned, error) {
	const statement = `
		SELECT jobs.id, COALESCE(jobs.published_at, jobs.scheduled_for), jobs.draft_id, drafts.topic, drafts.platform, drafts.format,
			CASE WHEN jobs.status = 'publishing' AND jobs.claimed_at < now() - interval '10 minutes' THEN 'needs_attention' ELSE jobs.status END,
			connections.display_name
		FROM publish_jobs AS jobs
		JOIN content_drafts AS drafts ON drafts.company_id = jobs.company_id AND drafts.id = jobs.draft_id
		LEFT JOIN social_connections AS connections ON connections.company_id = jobs.company_id AND connections.id = jobs.connection_id
		WHERE jobs.company_id = $1 AND jobs.status <> 'canceled' AND jobs.scheduled_for >= $2 AND jobs.scheduled_for < $3
		ORDER BY jobs.scheduled_for, jobs.id LIMIT $4`
	return collectPlanned(q.Query(ctx, statement, company.String(), from, to, limit))
}

func collectPlanned(rows pgx.Rows, err error) ([]Planned, error) {
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Planned, error) {
		var p Planned
		err := row.Scan(&p.ID, &p.At, &p.DraftID, &p.Topic, &p.Platform, &p.Format, &p.Status, &p.AccountName)
		return p, err
	})
}

// Idea is one idea to save: a draft holding only its topic, planned for a moment.
type Idea struct {
	Post
	PlannedFor time.Time
}

// SaveIdeas saves every idea, or none, each a draft in status idea with
// its "idea_planned" activity row, while actorUserID is an active owner
// (read again FOR SHARE). Every column named: nothing else rides along.
func SaveIdeas(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, ideas []Idea) (int, string, error) {
	saved := 0
	outcome := profile.NotAllowed
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role != "owner" {
			return err
		}
		const insert = `
			INSERT INTO content_drafts (company_id, platform, format, topic, pillar, campaign, body, hashtags, call_to_action,
				status, version, generated_version, claims, facts_used, knowledge_used, plan_version, planned_for, created_by_user_id, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, '', '{}'::text[], '', 'idea', 1, NULL, '[]'::jsonb, '[]'::jsonb, '{}'::uuid[], NULL, $7, $8, $8)
			RETURNING id`
		// The actor as text: Better Auth's ids are letters and digits, not uuids.
		const activity = `
			INSERT INTO cofounder_activity (company_id, actor_user_id, action, draft_id, job_id, connection_id, rule_id, plan_version, code)
			VALUES ($1, $2, 'idea_planned', $3, NULL, NULL, NULL, NULL, NULL)`
		for _, idea := range ideas {
			var draftID string
			if err := tx.QueryRow(ctx, insert, company.String(), idea.Platform, idea.Format, idea.Topic, idea.Pillar, idea.Campaign, idea.PlannedFor, actorUserID).Scan(&draftID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, activity, company.String(), actorUserID, draftID); err != nil {
				return err
			}
			saved++
		}
		outcome = profile.Saved
		return nil
	})
	return saved, outcome, err
}
