package home

import (
	"context"

	"ansa/core/internal/database"
	"ansa/core/internal/profile"
	"ansa/core/internal/tenant"
)

// Home's "Your business in numbers" (the old services/business-overview.ts,
// db/business-overview.ts). Each count is the company's own and reads at
// most OverviewCountLimit + 1 rows (a company with years of history costs
// no more than a new one; past it the page says "10,000+"), and uses the
// same condition as the list it links to, so a number matches what it opens.

// OverviewCountLimit: a count past it shows as "10,000+".
const OverviewCountLimit = 10_000

// The key business facts: the business profile's own list (16 of its 25).
var keyFactTopics = func() []string {
	var keys []string
	for _, topic := range profile.KeyTopics() {
		keys = append(keys, topic.Key)
	}
	return keys
}()

// Overview is the support numbers, and the marketing helper's once the
// company started it (a fact, an interview answer or a draft).
type Overview struct {
	Support   SupportNumbers    `json:"support"`
	Marketing *MarketingNumbers `json:"cofounder"`
	// Only owners answer the interview, so only they are invited to start.
	CanStartMarketing bool `json:"canStartCofounder"`
}

// SupportNumbers are the requests, calls, emails and conversations.
type SupportNumbers struct {
	OpenTickets       int `json:"openTickets"`
	UnassignedTickets int `json:"unassignedTickets"`
	// Open requests in no conversation (typed in, a hidden caller's, from
	// before the Inbox) that nobody has or the viewer has: Home lists
	// conversations by name, so without a team these would show nowhere.
	RequestsWaitingForYou   int `json:"requestsWaitingForYou"`
	CallsLastWeek           int `json:"callsLastWeek"`
	CallsSolvedByAILastWeek int `json:"callsSolvedByAiLastWeek"`
	EmailsWaiting           int `json:"emailsWaiting"`
	EmailsStuck             int `json:"emailsStuck"`
	ConversationsNeedingYou int `json:"conversationsNeedingYou"`
}

// MarketingNumbers are the posts' and the business profile's.
type MarketingNumbers struct {
	DraftsWaitingForApproval int `json:"draftsWaitingForApproval"`
	PostsScheduledNextWeek   int `json:"postsScheduledNextWeek"`
	PostsNeedingAttention    int `json:"postsNeedingAttention"`
	PostsFailedLastWeek      int `json:"postsFailedLastWeek"`
	KeyFactsConfirmed        int `json:"keyFactsConfirmed"`
	KeyFactsTotal            int `json:"keyFactsTotal"`
	AccountsNeedingReconnect int `json:"accountsNeedingReconnect"`
}

// ReadOverview reads the company's numbers as this person (role, userID) sees them.
func ReadOverview(ctx context.Context, pool *database.Pool, company tenant.CompanyID, role, userID string) (Overview, error) {
	o := Overview{CanStartMarketing: role == "owner"}
	s := &o.Support
	const support = `
		SELECT
			(SELECT count(*) FROM (SELECT 1 FROM tickets WHERE tickets.company_id = $1 AND status = 'open' LIMIT $2) AS counted),
			(SELECT count(*) FROM (SELECT 1 FROM tickets WHERE tickets.company_id = $1 AND status = 'open' AND assigned_to_user_id IS NULL LIMIT $2) AS counted),
			(SELECT count(*) FROM (SELECT 1 FROM tickets WHERE tickets.company_id = $1 AND status = 'open' AND conversation_id IS NULL
				AND (assigned_to_user_id IS NULL OR assigned_to_user_id = $3) LIMIT $2) AS counted),
			(SELECT count(*) FROM (SELECT 1 FROM calls WHERE calls.company_id = $1 AND created_at >= now() - interval '7 days' LIMIT $2) AS counted),
			(SELECT count(*) FROM (SELECT 1 FROM calls WHERE calls.company_id = $1 AND created_at >= now() - interval '7 days'
				AND analysis_status = 'decided' AND ai_outcome = 'solved' LIMIT $2) AS counted),
			(SELECT count(*) FROM (SELECT 1 FROM inbound_emails WHERE inbound_emails.company_id = $1 AND status IN ('received', 'processing')
				AND NOT ` + stuckEmail + ` LIMIT $2) AS counted),
			(SELECT count(*) FROM (SELECT 1 FROM inbound_emails WHERE inbound_emails.company_id = $1 AND ` + stuckEmail + ` LIMIT $2) AS counted),
			(SELECT count(*) FROM (SELECT 1 FROM conversations WHERE conversations.company_id = $1 AND ` + needsYou + ` LIMIT $2) AS counted)`
	err := pool.QueryRow(ctx, support, company.String(), OverviewCountLimit+1, userID).Scan(&s.OpenTickets, &s.UnassignedTickets, &s.RequestsWaitingForYou,
		&s.CallsLastWeek, &s.CallsSolvedByAILastWeek, &s.EmailsWaiting, &s.EmailsStuck, &s.ConversationsNeedingYou)
	if err != nil {
		return o, err
	}
	var started bool
	const startedMarketing = `
		SELECT EXISTS (SELECT 1 FROM business_facts WHERE company_id = $1)
			OR EXISTS (SELECT 1 FROM onboarding_messages WHERE company_id = $1)
			OR EXISTS (SELECT 1 FROM content_drafts WHERE company_id = $1)`
	if err := pool.QueryRow(ctx, startedMarketing, company.String()).Scan(&started); err != nil || !started {
		return o, err
	}
	m := &MarketingNumbers{KeyFactsTotal: len(keyFactTopics)}
	const marketing = `
		SELECT
			(SELECT count(*) FROM (SELECT 1 FROM content_drafts WHERE content_drafts.company_id = $1 AND status = 'draft' LIMIT $2) AS counted),
			(SELECT count(*) FROM (SELECT 1 FROM publish_jobs WHERE publish_jobs.company_id = $1 AND status = 'queued'
				AND scheduled_for < now() + interval '7 days' LIMIT $2) AS counted),
			(SELECT count(*) FROM (SELECT 1 FROM publish_jobs WHERE publish_jobs.company_id = $1 AND (status = 'needs_attention'
				OR (status = 'publishing' AND claimed_at < now() - interval '10 minutes')) LIMIT $2) AS counted),
			(SELECT count(*) FROM (SELECT 1 FROM publish_jobs WHERE publish_jobs.company_id = $1 AND status = 'failed'
				AND updated_at >= now() - interval '7 days' LIMIT $2) AS counted),
			(SELECT count(*) FROM business_facts WHERE business_facts.company_id = $1 AND topic = ANY($3) AND confirmed_value IS NOT NULL),
			(SELECT count(*) FROM social_connections WHERE social_connections.company_id = $1 AND (status = 'needs_reauth'
				OR (status = 'connected' AND access_expires_at <= now()
					AND (refresh_token_encrypted IS NULL OR (refresh_expires_at IS NOT NULL AND refresh_expires_at <= now())))))`
	err = pool.QueryRow(ctx, marketing, company.String(), OverviewCountLimit+1, keyFactTopics).Scan(&m.DraftsWaitingForApproval,
		&m.PostsScheduledNextWeek, &m.PostsNeedingAttention, &m.PostsFailedLastWeek, &m.KeyFactsConfirmed, &m.AccountsNeedingReconnect)
	o.Marketing = m
	return o, err
}

// A received email unfinished for 15+ minutes (the Emails page's "stuck").
const stuckEmail = `((inbound_emails.status = 'received' AND inbound_emails.received_at < now() - interval '15 minutes')
	OR (inbound_emails.status = 'processing' AND inbound_emails.processing_started_at < now() - interval '15 minutes'))`

// The Inbox's "Needs you" (internal/inbox/list.go keeps the same one).
const needsYou = `(
	EXISTS (SELECT 1 FROM tickets WHERE tickets.company_id = conversations.company_id AND tickets.conversation_id = conversations.id AND tickets.status = 'open')
	OR EXISTS (SELECT 1 FROM messages WHERE messages.company_id = conversations.company_id AND messages.conversation_id = conversations.id AND messages.send_status = 'draft'))`

// HandlesNoCategory: the company has active categories but this person
// handles none, so routing by category never gives them a request.
func HandlesNoCategory(ctx context.Context, pool *database.Pool, company tenant.CompanyID, userID string) (bool, error) {
	const statement = `
		SELECT EXISTS (SELECT 1 FROM categories WHERE categories.company_id = $1 AND archived_at IS NULL)
			AND NOT EXISTS (SELECT 1 FROM user_categories JOIN categories ON categories.company_id = user_categories.company_id AND categories.id = user_categories.category_id
				WHERE user_categories.company_id = $1 AND user_categories.user_id = $2 AND categories.archived_at IS NULL)`
	var none bool
	err := pool.QueryRow(ctx, statement, company.String(), userID).Scan(&none)
	return none, err
}
