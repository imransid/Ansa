package strategy

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/profile"
	"ansa/core/internal/tenant"
)

// How many versions the Strategy page lists, newest first.
const versionsShown = 50

// Page is the Strategy page (the old MarketingStrategy): the current plan,
// the newest versions, what a new plan still needs, and the setting.
type Page struct {
	Current *ShownPlan `json:"current"`
	// 0: no plan yet. Versions are 1, 2, 3, ..., so this is also how many there are.
	NewestVersion     int              `json:"newestVersion"`
	Versions          []VersionSummary `json:"versions"`
	MissingForPlan    []MissingFact    `json:"missingForPlan"`
	UsesSupportTrends bool             `json:"usesSupportTrends"`
}

// ShownPlan is one stored version as the page shows it. Content nil: saved
// in a shape this code can't read. Every field named: nothing else leaves.
type ShownPlan struct {
	Version           int            `json:"version"`
	CreatedAt         time.Time      `json:"createdAt"`
	CreatedByName     *string        `json:"createdByName"`
	GoalNote          *string        `json:"goalNote"`
	Content           *Plan          `json:"content"`
	FactsUsed         []ShownFact    `json:"factsUsed"`
	KnowledgeUsed     []ShownArticle `json:"knowledgeUsed"`
	UsedSupportTrends bool           `json:"usedSupportTrends"`
	PastPerformance   *ReviewDates   `json:"pastPerformance"`
	// The confirmed facts are no longer exactly the ones it was made from.
	ProfileChangedSince bool `json:"profileChangedSince"`
}

// ShownFact is one fact a plan was made from, as it was then.
type ShownFact struct {
	Topic string `json:"topic"`
	Label string `json:"label"`
	Value string `json:"value"`
}

// ShownArticle is one article a plan read; Title nil: deleted since.
type ShownArticle struct {
	ArticleID string  `json:"articleId"`
	Title     *string `json:"title"`
}

// ReadPage reads one company's Strategy page.
func ReadPage(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (Page, error) {
	page := Page{Versions: []VersionSummary{}}
	facts, err := profile.ReadFacts(ctx, pool, company)
	if err != nil {
		return page, err
	}
	page.MissingForPlan = MissingForPlan(facts.ConfirmedTopics())
	if page.Versions, err = ListVersions(ctx, pool, company, versionsShown); err != nil {
		return page, err
	}
	if page.UsesSupportTrends, err = UsesSupportTrends(ctx, pool, company); err != nil {
		return page, err
	}
	stored, err := ReadVersion(ctx, pool, company, 0)
	if err != nil || stored == nil {
		return page, err
	}
	page.NewestVersion = stored.Version
	page.Current, err = showPlan(ctx, pool, company, stored, facts)
	return page, err
}

// VersionPage is one version of the plan, and the newest number (for the
// links to the one before and after).
type VersionPage struct {
	Plan          *ShownPlan `json:"plan"`
	NewestVersion int        `json:"newestVersion"`
}

// ReadVersionPage reads one version by the number in the address (only a
// claim): nil when the company has no such version.
func ReadVersionPage(ctx context.Context, pool *database.Pool, company tenant.CompanyID, version int) (*VersionPage, error) {
	if version < 1 {
		return nil, nil
	}
	stored, err := ReadVersion(ctx, pool, company, version)
	if err != nil || stored == nil {
		return nil, err
	}
	newest, err := ReadVersion(ctx, pool, company, 0)
	if err != nil {
		return nil, err
	}
	facts, err := profile.ReadFacts(ctx, pool, company)
	if err != nil {
		return nil, err
	}
	shown, err := showPlan(ctx, pool, company, stored, facts)
	return &VersionPage{Plan: shown, NewestVersion: newest.Version}, err
}

// showPlan reads a stored version for the page: the plan through ReadPlan,
// the fact rule again against its own facts, the articles' titles now.
func showPlan(ctx context.Context, q profile.Querier, company tenant.CompanyID, stored *StoredPlan, current profile.Facts) (*ShownPlan, error) {
	var used []UsedFact
	if json.Unmarshal(stored.FactsUsed, &used) != nil {
		used = nil
	}
	sent := map[string]bool{}
	shown := &ShownPlan{Version: stored.Version, CreatedAt: stored.CreatedAt, CreatedByName: stored.CreatedByName, GoalNote: stored.GoalNote,
		FactsUsed: []ShownFact{}, KnowledgeUsed: []ShownArticle{}, UsedSupportTrends: stored.UsedSupportTrends, PastPerformance: stored.PastPerformance}
	for _, fact := range used {
		sent[fact.Topic] = true
		shown.FactsUsed = append(shown.FactsUsed, ShownFact{Topic: fact.Topic, Label: profile.LabelOf(fact.Topic), Value: fact.Value})
	}
	if plan, ok := ReadPlan(stored.Plan, sent); ok {
		shown.Content = plan
	}
	titles, err := articleTitles(ctx, q, company, stored.KnowledgeUsed)
	for _, id := range stored.KnowledgeUsed {
		article := ShownArticle{ArticleID: id}
		if title, found := titles[id]; found {
			article.Title = &title
		}
		shown.KnowledgeUsed = append(shown.KnowledgeUsed, article)
	}
	shown.ProfileChangedSince = !sameFacts(used, current)
	return shown, err
}

// articleTitles are the titles of these articles, read within the company.
func articleTitles(ctx context.Context, q profile.Querier, company tenant.CompanyID, ids []string) (map[string]string, error) {
	titles := map[string]string{}
	if len(ids) == 0 {
		return titles, nil
	}
	rows, err := q.Query(ctx, `SELECT id::text, title FROM knowledge_articles WHERE company_id = $1 AND id = ANY($2::uuid[])`, company.String(), ids)
	if err != nil {
		return titles, err
	}
	var id, title string
	_, err = pgx.ForEachRow(rows, []any{&id, &title}, func() error {
		titles[id] = title
		return nil
	})
	return titles, err
}

// sameFacts: the confirmed facts now are exactly the ones a plan was made from.
func sameFacts(used []UsedFact, current profile.Facts) bool {
	confirmed := 0
	for _, values := range current {
		if values.Confirmed != "" {
			confirmed++
		}
	}
	if len(used) != confirmed {
		return false
	}
	for _, fact := range used {
		if current[fact.Topic].Confirmed != fact.Value {
			return false
		}
	}
	return true
}
