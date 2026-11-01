package strategy

import (
	"context"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/knowledge"
	"ansa/core/internal/profile"
	"ansa/core/internal/tenant"
)

// What a plan is made from (the old services/marketing-plan-inputs.ts):
// the confirmed facts (never a proposal), the approved marketing articles
// (the search's audience: never a draft, an archived article or one for
// support only), the newest performance review, and the ticket counts per
// category only while an owner has that setting on. Nothing else of
// support, ever; nothing about the account.

const (
	// The most characters of knowledge the plan reads, tags included.
	knowledgeSliceCharacters = 6_000
	// How many hits the search gives (all it can): the slice keeps what fits.
	knowledgeHitsToRead = 10
	// Support trends: tickets per category over these days, at most this many categories.
	supportTrendDays          = 30
	supportTrendCategoriesMax = 100
)

// The topics whose words find the articles a plan reads: what the business
// sells and what it wants marketing to do, taking turns at the words.
var knowledgeSearchTopics = map[string]bool{"products": true, "services": true, "goals": true}

// BrainFact is one fact or topic as the brain gets it (Value "" for an unconfirmed topic).
type BrainFact struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Value string `json:"value,omitempty"`
}

// Trend is one category's ticket count of the last 30 days.
type Trend struct {
	Category string `json:"category"`
	Tickets  int    `json:"tickets"`
}

// Inputs are one plan's request and what it records about it.
type Inputs struct {
	Facts               []UsedFact
	Request             map[string]any
	KnowledgeUsed       []string
	UsedSupportTrends   bool
	PerformanceReviewID string
}

// GatherInputs gathers one company's plan request from its confirmed facts.
func GatherInputs(ctx context.Context, pool *database.Pool, company tenant.CompanyID, facts profile.Facts, goalNote string) (Inputs, error) {
	in := Inputs{Facts: []UsedFact{}, KnowledgeUsed: []string{}}
	confirmed, unconfirmed := []BrainFact{}, []BrainFact{}
	var searchTexts []string
	for _, topic := range profile.Topics {
		value := facts[topic.Key].Confirmed
		if value == "" {
			unconfirmed = append(unconfirmed, BrainFact{Key: topic.Key, Label: topic.Label})
			continue
		}
		in.Facts = append(in.Facts, UsedFact{Topic: topic.Key, Value: value})
		confirmed = append(confirmed, BrainFact{Key: topic.Key, Label: topic.Label, Value: value})
		if knowledgeSearchTopics[topic.Key] {
			searchTexts = append(searchTexts, value)
		}
	}
	slice, err := marketingKnowledge(ctx, pool, company, searchTexts, &in)
	if err != nil {
		return in, err
	}
	request := map[string]any{"facts": confirmed, "unconfirmed_topics": unconfirmed, "knowledge": slice, "goal_note": goalNote}
	if in.UsedSupportTrends, err = UsesSupportTrends(ctx, pool, company); err != nil {
		return in, err
	}
	if in.UsedSupportTrends {
		if request["support_trends"], err = CountRecentTickets(ctx, pool, company); err != nil {
			return in, err
		}
	}
	past, reviewID, err := NewestReview(ctx, pool, company)
	if past != nil {
		request["past_performance"] = past
		in.PerformanceReviewID = reviewID
	}
	in.Request = request
	return in, err
}

// marketingKnowledge is the slice of approved marketing articles matching
// the facts' words, whole pieces best first within 6,000 characters, and
// records which articles it holds (each once).
func marketingKnowledge(ctx context.Context, pool *database.Pool, company tenant.CompanyID, searchTexts []string, in *Inputs) (string, error) {
	hits, err := knowledge.Search(ctx, pool, company, knowledge.CombineSearchTexts(searchTexts), "marketing", knowledgeHitsToRead)
	if err != nil {
		return "", err
	}
	kept, slice := knowledge.Slice(hits, knowledgeSliceCharacters)
	seen := map[string]bool{}
	for _, hit := range kept {
		if !seen[hit.ArticleID] {
			seen[hit.ArticleID] = true
			in.KnowledgeUsed = append(in.KnowledgeUsed, hit.ArticleID)
		}
	}
	return slice, nil
}

// CountRecentTickets is one company's tickets of the last 30 days per
// category (none without one), the most first: category names and numbers
// only, never a ticket's subject, text or customer.
func CountRecentTickets(ctx context.Context, q profile.Querier, company tenant.CompanyID) ([]Trend, error) {
	const statement = `
		SELECT category, count(*) FROM tickets
		WHERE company_id = $1 AND category IS NOT NULL AND created_at >= now() - make_interval(days => $2)
		GROUP BY category ORDER BY count(*) DESC, category ASC LIMIT $3`
	rows, err := q.Query(ctx, statement, company.String(), supportTrendDays, supportTrendCategoriesMax)
	if err != nil {
		return nil, err
	}
	trends, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Trend, error) {
		var trend Trend
		err := row.Scan(&trend.Category, &trend.Tickets)
		return trend, err
	})
	// An empty list, never null: the setting is on, and the AI is told there were none.
	return append([]Trend{}, trends...), err
}
