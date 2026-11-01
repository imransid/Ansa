package home

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// AwaySummary is "While you were away": what ansa did since this person
// last pressed "Got it" (or in the last day, before the first time).
type AwaySummary struct {
	Since         time.Time  `json:"since"`
	Replies       int        `json:"replies"`
	Notes         int        `json:"notes"`
	Waiting       int        `json:"waiting"`
	Conversations []AwayLine `json:"conversations"`
}

// AwayLine is one conversation's newest line (each conversation once).
type AwayLine struct {
	ConversationID string    `json:"conversationId"`
	ContactName    *string   `json:"contactName"`
	Channel        string    `json:"channel"`
	Action         string    `json:"action"`
	Reason         *string   `json:"reason"`
	CreatedAt      time.Time `json:"createdAt"`
}

// ReadAwaySummary counts ansa's newest 200 lines since then and lists the
// newest 8 conversations.
func ReadAwaySummary(ctx context.Context, pool *database.Pool, company tenant.CompanyID, userID string) (AwaySummary, error) {
	summary := AwaySummary{Conversations: []AwayLine{}}
	const since = `
		SELECT COALESCE((SELECT seen_at FROM away_summary_reads WHERE company_id = $1 AND user_id = $2), now() - interval '1 day')`
	if err := pool.QueryRow(ctx, since, company.String(), userID).Scan(&summary.Since); err != nil {
		return summary, err
	}
	const lines = `
		SELECT assistant_activity.conversation_id, contacts.display_name, contacts.channel, assistant_activity.action,
			assistant_activity.reason, assistant_activity.created_at
		FROM assistant_activity
		JOIN conversations ON conversations.id = assistant_activity.conversation_id AND conversations.company_id = assistant_activity.company_id
		JOIN contacts ON contacts.id = conversations.contact_id AND contacts.company_id = conversations.company_id
		WHERE assistant_activity.company_id = $1 AND assistant_activity.actor_user_id IS NULL
			AND assistant_activity.action IN ('replied', 'drafted', 'handed_over') AND assistant_activity.created_at > $2
		ORDER BY assistant_activity.created_at DESC LIMIT 200`
	rows, err := pool.Query(ctx, lines, company.String(), summary.Since)
	if err != nil {
		return summary, err
	}
	seen := map[string]bool{}
	for rows.Next() {
		var line AwayLine
		if err := rows.Scan(&line.ConversationID, &line.ContactName, &line.Channel, &line.Action, &line.Reason, &line.CreatedAt); err != nil {
			return summary, err
		}
		switch line.Action {
		case "replied":
			summary.Replies++
		case "handed_over":
			summary.Notes++
		case "drafted":
			summary.Waiting++
		}
		if !seen[line.ConversationID] && len(summary.Conversations) < 8 {
			seen[line.ConversationID] = true
			summary.Conversations = append(summary.Conversations, line)
		}
	}
	return summary, rows.Err()
}

// MarkAwaySummarySeen is "Got it": the summary starts again from now for
// this person (anyone in the company, read again).
func MarkAwaySummarySeen(ctx context.Context, pool *database.Pool, company tenant.CompanyID, userID string) (bool, error) {
	allowed := false
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, userID)
		if err != nil || role == "" {
			return err
		}
		allowed = true
		const upsert = `
			INSERT INTO away_summary_reads (company_id, user_id, seen_at) VALUES ($1, $2, now())
			ON CONFLICT (company_id, user_id) DO UPDATE SET seen_at = now()`
		_, err = tx.Exec(ctx, upsert, company.String(), userID)
		return err
	})
	return allowed, err
}
