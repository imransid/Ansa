package profile

import (
	"context"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/knowledge"
	"ansa/core/internal/tenant"
)

// "Suggest facts from knowledge" (the old services/fact-suggestions.ts):
// an owner picks one of the company's approved articles meant for support
// or marketing, and the AI proposes the facts it states. Proposals only,
// saved beside the confirmed values for an owner to confirm or dismiss.

// The most of one article the AI reads: its first whole pieces, tags included.
const articleCharactersForSuggestions = 10_000

// The most articles a company has, so the menu never leaves one out.
const articlesPerCompany = 1_000

// What a suggestion ended in, besides Saved and NotAllowed.
const (
	// Not an approved article of the company: drafts and archived ones are never given to any AI.
	ArticleNotFound = "not-found"
	// Ticked for neither support nor marketing: its page says nothing uses it.
	ArticleNotForAI = "not-for-ai"
	// The AI couldn't read it just now: nothing was proposed.
	NoAnswer = "no-answer"
)

// ArticleChoice is one approved article an owner may pick.
type ArticleChoice struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// ArticlesForSuggestions are every approved article of one company ticked
// for support or marketing, by title.
func ArticlesForSuggestions(ctx context.Context, q Querier, company tenant.CompanyID) ([]ArticleChoice, error) {
	const statement = `
		SELECT id, title FROM knowledge_articles
		WHERE company_id = $1 AND status = 'approved' AND (use_for_support OR use_for_marketing)
		ORDER BY title, id LIMIT $2`
	rows, err := q.Query(ctx, statement, company.String(), articlesPerCompany)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (ArticleChoice, error) {
		var choice ArticleChoice
		err := row.Scan(&choice.ID, &choice.Title)
		return choice, err
	})
}

// SuggestResult: the topics that got a new proposal (none: the article said
// nothing new), and whether the whole article fit in what the AI reads.
type SuggestResult struct {
	Outcome          string       `json:"outcome"`
	ProposedTopics   []TopicLabel `json:"proposedTopics"`
	ReadWholeArticle bool         `json:"readWholeArticle"`
}

// Suggest lets the AI read one approved article of the company and saves
// the facts it proposes, while actorUserID is still an active owner.
func (s *Service) Suggest(ctx context.Context, company tenant.CompanyID, actorUserID, articleID string) (SuggestResult, error) {
	article, err := knowledge.Read(ctx, s.Pool, company, articleID)
	if err != nil {
		return SuggestResult{}, err
	}
	if article == nil || article.Status != "approved" {
		return SuggestResult{Outcome: ArticleNotFound}, nil
	}
	if !article.UseForSupport && !article.UseForMarketing {
		return SuggestResult{Outcome: ArticleNotForAI}, nil
	}
	facts, err := ReadFacts(ctx, s.Pool, company)
	if err != nil {
		return SuggestResult{}, err
	}
	pieces := knowledge.ChunkBody(article.Body)
	hits := make([]knowledge.Hit, 0, len(pieces))
	for _, piece := range pieces {
		hits = append(hits, knowledge.Hit{Title: article.Title, Text: piece})
	}
	kept, slice := knowledge.Slice(hits, articleCharactersForSuggestions)
	var answer struct {
		BrainFailure
		ProposedFacts []Proposal `json:"proposed_facts"`
	}
	err = s.Brain.Call(ctx, factSuggestionsPath, map[string]any{"topics": BrainTopics(facts), "article": slice}, &answer)
	LogFailure(s.Log, "fact suggestions: the AI failed", answer.BrainFailure, err)
	if err != nil || answer.Kind != "ok" {
		return SuggestResult{Outcome: NoAnswer}, nil
	}
	topics, outcome, err := SaveKnowledgeProposals(ctx, s.Pool, company, actorUserID, answer.ProposedFacts)
	if err != nil || outcome == NotAllowed {
		return SuggestResult{Outcome: outcome}, err
	}
	return SuggestResult{Outcome: Saved, ProposedTopics: labelsOfKeys(topics), ReadWholeArticle: len(kept) == len(pieces)}, nil
}
