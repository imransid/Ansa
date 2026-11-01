package strategy

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/profile"
	"ansa/core/internal/settings"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// UsedFact is one confirmed fact a plan was made from, as it was then.
type UsedFact struct {
	Topic string `json:"topic"`
	Value string `json:"value"`
}

// NewPlan is a version to save. GoalNote and PerformanceReviewID: "" = none.
type NewPlan struct {
	GoalNote            string
	Plan                *Plan
	FactsUsed           []UsedFact
	KnowledgeUsed       []string
	UsedSupportTrends   bool
	PerformanceReviewID string
}

// SavePlan saves a new version made by actorUserID while they are still an
// active owner, and its "plan_created" activity row, in ONE transaction.
// WHY the company row lock first: two plans saved at the same moment would
// both read the same newest version and take the same next one (the unique
// constraint would then refuse one, and that plan would be lost). Under
// the lock they count one after the other, as ticket numbers do.
func SavePlan(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, p NewPlan) (int, string, error) {
	planJSON, err := json.Marshal(p.Plan)
	if err != nil {
		return 0, "", err
	}
	factsJSON, err := json.Marshal(p.FactsUsed)
	if err != nil {
		return 0, "", err
	}
	knowledge := append([]string{}, p.KnowledgeUsed...)
	version := 0
	outcome := profile.NotAllowed
	err = database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role != "owner" {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT COALESCE(max(version), 0) + 1 FROM marketing_plans WHERE company_id = $1`, company.String()).Scan(&version); err != nil {
			return err
		}
		const insert = `
			INSERT INTO marketing_plans (company_id, version, goal_note, plan, facts_used, knowledge_used, used_support_trends, performance_review_id, created_by_user_id)
			VALUES ($1, $2, NULLIF($3, ''), $4::jsonb, $5::jsonb, $6::uuid[], $7, NULLIF($8, '')::uuid, $9)`
		if _, err := tx.Exec(ctx, insert, company.String(), version, p.GoalNote, string(planJSON), string(factsJSON), knowledge, p.UsedSupportTrends, p.PerformanceReviewID, actorUserID); err != nil {
			return err
		}
		const activity = `
			INSERT INTO cofounder_activity (company_id, actor_user_id, action, draft_id, job_id, connection_id, rule_id, plan_version, code)
			VALUES ($1, $2, 'plan_created', NULL, NULL, NULL, NULL, $3, NULL)`
		if _, err := tx.Exec(ctx, activity, company.String(), actorUserID, version); err != nil {
			return err
		}
		outcome = profile.Saved
		return nil
	})
	return version, outcome, err
}

// StoredPlan is one version as stored; who made it and the review it read
// are read within the company.
type StoredPlan struct {
	Version           int
	GoalNote          *string
	Plan              []byte
	FactsUsed         []byte
	KnowledgeUsed     []string
	UsedSupportTrends bool
	PastPerformance   *ReviewDates
	CreatedAt         time.Time
	CreatedByName     *string
}

// ReviewDates: the performance review a plan read as past performance.
type ReviewDates struct {
	ReviewedAt  time.Time `json:"reviewedAt"`
	PeriodStart time.Time `json:"periodStart"`
	PeriodEnd   time.Time `json:"periodEnd"`
}

// ReadVersion is one version (version 0: the newest), nil when there is none.
func ReadVersion(ctx context.Context, q profile.Querier, company tenant.CompanyID, version int) (*StoredPlan, error) {
	const statement = `
		SELECT plans.version, plans.goal_note, plans.plan::text, plans.facts_used::text, plans.knowledge_used::text[], plans.used_support_trends,
			reviews.created_at, reviews.period_start, reviews.period_end, plans.created_at, creator.name
		FROM marketing_plans AS plans
		LEFT JOIN users AS creator ON creator.company_id = plans.company_id AND creator.id = plans.created_by_user_id
		LEFT JOIN performance_reviews AS reviews ON reviews.company_id = plans.company_id AND reviews.id = plans.performance_review_id
		WHERE plans.company_id = $1 AND ($2 = 0 OR plans.version = $2)
		ORDER BY plans.version DESC LIMIT 1`
	rows, err := q.Query(ctx, statement, company.String(), version)
	if err != nil {
		return nil, err
	}
	plan, err := pgx.CollectExactlyOneRow(rows, scanPlan)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return plan, err
}

func scanPlan(row pgx.CollectableRow) (*StoredPlan, error) {
	var p StoredPlan
	var planText, factsText string
	var reviewedAt, periodStart, periodEnd *time.Time
	err := row.Scan(&p.Version, &p.GoalNote, &planText, &factsText, &p.KnowledgeUsed, &p.UsedSupportTrends,
		&reviewedAt, &periodStart, &periodEnd, &p.CreatedAt, &p.CreatedByName)
	p.Plan, p.FactsUsed = []byte(planText), []byte(factsText)
	if reviewedAt != nil && periodStart != nil && periodEnd != nil {
		p.PastPerformance = &ReviewDates{ReviewedAt: *reviewedAt, PeriodStart: *periodStart, PeriodEnd: *periodEnd}
	}
	return &p, err
}

// VersionSummary is one version in the Strategy page's list.
type VersionSummary struct {
	Version       int       `json:"version"`
	CreatedAt     time.Time `json:"createdAt"`
	CreatedByName *string   `json:"createdByName"`
	FactCount     int       `json:"factCount"`
}

// ListVersions are one company's newest versions, newest first. Versions
// are 1, 2, 3, ... and never deleted, so the first one's number is how
// many there are.
func ListVersions(ctx context.Context, q profile.Querier, company tenant.CompanyID, limit int) ([]VersionSummary, error) {
	const statement = `
		SELECT plans.version, plans.created_at, creator.name, jsonb_array_length(plans.facts_used)
		FROM marketing_plans AS plans
		LEFT JOIN users AS creator ON creator.company_id = plans.company_id AND creator.id = plans.created_by_user_id
		WHERE plans.company_id = $1
		ORDER BY plans.version DESC LIMIT $2`
	rows, err := q.Query(ctx, statement, company.String(), limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (VersionSummary, error) {
		var v VersionSummary
		err := row.Scan(&v.Version, &v.CreatedAt, &v.CreatedByName, &v.FactCount)
		return v, err
	})
}

// UsesSupportTrends: whether one company's plans may read its ticket
// counts per category (off by default; owners turn it on).
func UsesSupportTrends(ctx context.Context, q profile.Querier, company tenant.CompanyID) (bool, error) {
	rows, err := q.Query(ctx, `SELECT cofounder_uses_support_trends FROM companies WHERE id = $1`, company.String())
	if err != nil {
		return false, err
	}
	uses, err := pgx.CollectExactlyOneRow(rows, pgx.RowTo[bool])
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return uses, err
}

// SetSupportTrends turns the setting on or off while actorUserID is an
// active owner (the company row lock first, then the person): "changed",
// "unchanged" (it was already so) or "not-allowed".
func SetSupportTrends(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, enabled bool) (string, error) {
	changed := false
	outcome, err := settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE companies SET cofounder_uses_support_trends = $2 WHERE id = $1 AND cofounder_uses_support_trends <> $2`, company.String(), enabled)
		changed = tag.RowsAffected() > 0
		return err
	})
	switch {
	case err != nil || outcome != settings.Saved:
		return profile.NotAllowed, err
	case changed:
		return profile.Changed, nil
	default:
		return profile.Unchanged, nil
	}
}
