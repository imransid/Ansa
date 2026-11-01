package inbox

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Activity is one line of what ansa or a person did (never a message's text).
type Activity struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversationId"`
	Action         string    `json:"action"`
	Reason         *string   `json:"reason"`
	CreatedAt      time.Time `json:"createdAt"`
	ActorName      *string   `json:"actorName"`
	ContactName    *string   `json:"contactName"`
	Channel        string    `json:"channel"`
}

// ListActivity is one conversation's newest lines, or ("" conversation)
// ansa's own newest work across the company (Home's "What ansa did").
func ListActivity(ctx context.Context, pool *database.Pool, company tenant.CompanyID, conversationID string, limit int) ([]Activity, error) {
	const statement = `
		SELECT assistant_activity.id, assistant_activity.conversation_id, assistant_activity.action, assistant_activity.reason,
			assistant_activity.created_at, actor.name, contacts.display_name, contacts.channel
		FROM assistant_activity
		JOIN conversations ON conversations.id = assistant_activity.conversation_id AND conversations.company_id = assistant_activity.company_id
		JOIN contacts ON contacts.id = conversations.contact_id AND contacts.company_id = conversations.company_id
		LEFT JOIN users AS actor ON actor.id = assistant_activity.actor_user_id AND actor.company_id = assistant_activity.company_id
		WHERE assistant_activity.company_id = $1
			AND (($2 = '' AND assistant_activity.actor_user_id IS NULL) OR assistant_activity.conversation_id::text = $2)
		ORDER BY assistant_activity.created_at DESC LIMIT $3`
	rows, err := pool.Query(ctx, statement, company.String(), conversationID, limit)
	if err != nil {
		return nil, err
	}
	list := []Activity{}
	for rows.Next() {
		var a Activity
		if err := rows.Scan(&a.ID, &a.ConversationID, &a.Action, &a.Reason, &a.CreatedAt, &a.ActorName, &a.ContactName, &a.Channel); err != nil {
			return nil, err
		}
		list = append(list, a)
	}
	return list, rows.Err()
}
