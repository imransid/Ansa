package publishing

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// The activity lists (the queue page, a draft's page) show the newest this many.
const activityShown = 200

// ActivityListItem is one row of the Co-Founder's activity log as the pages
// list it, with the names it is about (the old ActivityListItem): the
// pages word it (lib/publishing/activity-text.ts). Never a token or a
// post's text: the log holds neither.
type ActivityListItem struct {
	ID        string    `json:"id"`
	Action    string    `json:"action"`
	Code      *string   `json:"code"`
	CreatedAt time.Time `json:"createdAt"`
	// nil: the app did it.
	ActorUserID        *string `json:"actorUserId"`
	ActorName          *string `json:"actorName"`
	DraftID            *string `json:"draftId"`
	DraftTopic         *string `json:"draftTopic"`
	DraftPlatform      *string `json:"draftPlatform"`
	JobID              *string `json:"jobId"`
	ConnectionPlatform *string `json:"connectionPlatform"`
	ConnectionName     *string `json:"connectionName"`
	RulePlatform       *string `json:"rulePlatform"`
	RulePillar         *string `json:"rulePillar"`
	PlanVersion        *int    `json:"planVersion"`
}

// listActivity is one company's newest entries, newest first: all of them,
// or one draft's (draftID "" = all). Every join matches the company too.
func listActivity(ctx context.Context, pool *database.Pool, company tenant.CompanyID, draftID string) ([]ActivityListItem, error) {
	const statement = `
		SELECT cofounder_activity.id, cofounder_activity.action, cofounder_activity.code, cofounder_activity.created_at,
			cofounder_activity.actor_user_id, actor.name, cofounder_activity.draft_id, content_drafts.topic, content_drafts.platform,
			cofounder_activity.job_id, social_connections.platform, social_connections.display_name,
			autopublish_rules.platform, autopublish_rules.pillar, cofounder_activity.plan_version
		FROM cofounder_activity
		LEFT JOIN users AS actor ON actor.company_id = cofounder_activity.company_id AND actor.id = cofounder_activity.actor_user_id
		LEFT JOIN content_drafts ON content_drafts.company_id = cofounder_activity.company_id AND content_drafts.id = cofounder_activity.draft_id
		LEFT JOIN social_connections ON social_connections.company_id = cofounder_activity.company_id AND social_connections.id = cofounder_activity.connection_id
		LEFT JOIN autopublish_rules ON autopublish_rules.company_id = cofounder_activity.company_id AND autopublish_rules.id = cofounder_activity.rule_id
		WHERE cofounder_activity.company_id = $1 AND ($2 = '' OR cofounder_activity.draft_id::text = $2)
		ORDER BY cofounder_activity.created_at DESC, cofounder_activity.id DESC
		LIMIT $3`
	rows, err := pool.Query(ctx, statement, company.String(), draftID, activityShown)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := []ActivityListItem{}
	for rows.Next() {
		var e ActivityListItem
		err := rows.Scan(&e.ID, &e.Action, &e.Code, &e.CreatedAt, &e.ActorUserID, &e.ActorName, &e.DraftID, &e.DraftTopic, &e.DraftPlatform,
			&e.JobID, &e.ConnectionPlatform, &e.ConnectionName, &e.RulePlatform, &e.RulePillar, &e.PlanVersion)
		if err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}
