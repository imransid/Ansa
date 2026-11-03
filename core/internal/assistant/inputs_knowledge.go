package assistant

import (
	"context"
	"fmt"

	"ansa/core/internal/database"
	"ansa/core/internal/knowledge"
	"ansa/core/internal/tenant"
)

// The articles the assistant reads: the best 3 hits, whole, within this many
// characters, found with the customer's newest 3 messages.
const (
	knowledgeHits           = 3
	knowledgeMaxCharacters  = 3_000
	knowledgeSearchMessages = 3
)

// AddKnowledge gives the brain the company's approved support articles that
// match the customer's newest messages (once the conversation is final: a
// real one, or the test box's typed message), each in its own escaped
// <article> tags. Their titles and texts count as the owner's own words for
// the checks (a price or a link written in an article may be repeated).
func (in *Inputs) AddKnowledge(ctx context.Context, pool *database.Pool, company tenant.CompanyID) error {
	// A follow-up ("And for 50?") has few words of its own: the questions
	// before it keep the article it follows, and the newest message's words
	// go first in every turn when there are more than a search keeps.
	query := knowledge.CombineSearchTexts(in.newestCustomerTexts(knowledgeSearchMessages))
	hits, err := knowledge.Search(ctx, pool, company, query, "support", knowledgeHits)
	if err != nil {
		return fmt.Errorf("knowledge: %w", err)
	}
	kept, text := knowledge.Slice(hits, knowledgeMaxCharacters)
	in.Request.Knowledge = text
	for _, hit := range kept {
		in.Checks.OwnerTexts = append(in.Checks.OwnerTexts, hit.Title, hit.Text)
	}
	return nil
}

// newestCustomerTexts are the customer's newest messages, newest first.
func (in *Inputs) newestCustomerTexts(count int) []string {
	var texts []string
	lines := in.Request.Conversation
	for i := len(lines) - 1; i >= 0 && len(texts) < count; i-- {
		if lines[i].Sender == "customer" {
			texts = append(texts, lines[i].Text)
		}
	}
	return texts
}
