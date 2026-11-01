package studio

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/tenant"
)

// What the content studio's pages show (the old services/content-drafts.ts).

// Page is one draft's page. Media is filled by the caller (the media
// library's panel for this draft).
type Page struct {
	ID               string        `json:"id"`
	Platform         string        `json:"platform"`
	Format           string        `json:"format"`
	Status           string        `json:"status"`
	Topic            string        `json:"topic"`
	Pillar           string        `json:"pillar"`
	Campaign         string        `json:"campaign"`
	Version          int           `json:"version"`
	GeneratedVersion *int          `json:"generatedVersion"`
	PlannedFor       *time.Time    `json:"plannedFor"`
	Fields           drafts.Fields `json:"fields"`
	// Someone changed the AI's text by hand (or wrote it): Regenerate asks first.
	EditedByHand  bool       `json:"editedByHand"`
	CreatedAt     time.Time  `json:"createdAt"`
	CreatedByName *string    `json:"createdByName"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	UpdatedByName *string    `json:"updatedByName"`
	Approval      *Approval  `json:"approval"`
	Rejection     *Rejection `json:"rejection"`
	// The rules and the claims of the saved version, against the facts now.
	Review drafts.Review `json:"review"`
	// What the AI's request held when it last wrote the text (nil: it never did).
	MadeFrom *MadeFrom `json:"madeFrom"`
	// The confirmed business name, for the preview (nil: not confirmed).
	BusinessName *string     `json:"businessName"`
	PlanChoices  PlanChoices `json:"planChoices"`
	Media        any         `json:"media"`
	// The draft's attached image or video id (the media panel reads it).
	MediaAssetID *string `json:"-"`
}

// Approval is the approval of the version on screen. ByActiveOwner false:
// the approver was made a member or removed, and nothing goes out until
// another owner approves it again.
type Approval struct {
	At            time.Time `json:"at"`
	ByName        *string   `json:"byName"`
	Version       int       `json:"version"`
	ClaimsChecked bool      `json:"claimsChecked"`
	ByActiveOwner bool      `json:"byActiveOwner"`
}

// Rejection is the last rejection, kept until the draft is approved.
type Rejection struct {
	At     time.Time `json:"at"`
	ByName *string   `json:"byName"`
	Note   *string   `json:"note"`
}

// MadeFrom is what the AI's request held: the facts as they were, the
// articles (titles read within the company; nil: deleted since), the plan.
type MadeFrom struct {
	Facts       []madeFromFact    `json:"facts"`
	Knowledge   []madeFromArticle `json:"knowledge"`
	PlanVersion *int              `json:"planVersion"`
}

type madeFromFact struct {
	Topic string `json:"topic"`
	Label string `json:"label"`
	Value string `json:"value"`
}

type madeFromArticle struct {
	ArticleID string  `json:"articleId"`
	Title     *string `json:"title"`
}

// ReadPage reads one draft's page with its review (nil: unknown, or
// another company's).
func ReadPage(ctx context.Context, pool *database.Pool, company tenant.CompanyID, draftID string) (*Page, error) {
	draft, err := drafts.Read(ctx, pool, company, draftID)
	if err != nil || draft == nil {
		return nil, err
	}
	facts, err := drafts.ConfirmedFacts(ctx, pool, company)
	if err != nil {
		return nil, err
	}
	plan, err := readCurrentPlan(ctx, pool, company)
	if err != nil {
		return nil, err
	}
	media, err := attachedMedia(ctx, pool, company, draft.MediaAssetID)
	if err != nil {
		return nil, err
	}
	madeFrom, err := describeMadeFrom(ctx, pool, company, draft)
	if err != nil {
		return nil, err
	}
	page := &Page{ID: draft.ID, Platform: draft.Platform, Format: draft.Format, Status: draft.Status, Topic: draft.Topic, Pillar: draft.Pillar,
		Campaign: draft.Campaign, Version: draft.Version, GeneratedVersion: draft.GeneratedVersion, PlannedFor: draft.PlannedFor, Fields: draft.Fields,
		EditedByHand: drafts.WasEditedByHand(draft.Version, draft.GeneratedVersion, draft.Fields), CreatedAt: draft.CreatedAt,
		CreatedByName: draft.CreatedByName, UpdatedAt: draft.UpdatedAt, UpdatedByName: draft.UpdatedByName,
		Approval: describeApproval(draft), MadeFrom: madeFrom, PlanChoices: choicesOf(plan), MediaAssetID: draft.MediaAssetID,
		Review: drafts.ReviewDraft(drafts.ForReview{Platform: draft.Platform, Format: draft.Format, Fields: draft.Fields, Version: draft.Version,
			GeneratedVersion: draft.GeneratedVersion, Claims: draft.Claims, FactsUsed: draft.FactsUsed, Media: media}, facts)}
	if draft.RejectedAt != nil {
		page.Rejection = &Rejection{At: *draft.RejectedAt, ByName: draft.RejectedByName, Note: draft.RejectionNote}
	}
	if name, has := facts["company_name"]; has {
		page.BusinessName = &name
	}
	return page, nil
}

// NewDraftOptions is what "New draft" needs: what the AI still needs
// confirmed (none: it can write), and the plan's pillars and campaigns.
type NewDraftOptions struct {
	MissingForAI []string    `json:"missingForAi"`
	PlanChoices  PlanChoices `json:"planChoices"`
}

// ReadNewDraftOptions reads "New draft"'s options for one company.
func ReadNewDraftOptions(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (NewDraftOptions, error) {
	facts, err := drafts.ConfirmedFacts(ctx, pool, company)
	if err != nil {
		return NewDraftOptions{}, err
	}
	plan, err := readCurrentPlan(ctx, pool, company)
	return NewDraftOptions{MissingForAI: drafts.MissingForTheAI(facts), PlanChoices: choicesOf(plan)}, err
}

// describeApproval is the approval of the version on screen while it holds.
func describeApproval(d *drafts.Detail) *Approval {
	if d.ApprovedAt == nil || d.ApprovedVersion == nil || *d.ApprovedVersion != d.Version {
		return nil
	}
	activeOwner := d.ApproverRole != nil && *d.ApproverRole == "owner" && d.ApproverDeactivatedAt == nil
	return &Approval{At: *d.ApprovedAt, ByName: d.ApprovedByName, Version: *d.ApprovedVersion, ClaimsChecked: d.ClaimsAcknowledgedAt != nil, ByActiveOwner: activeOwner}
}

// describeMadeFrom is the facts as they were sent and the articles' titles,
// read within the company (nil: the AI never wrote this draft).
func describeMadeFrom(ctx context.Context, pool *database.Pool, company tenant.CompanyID, d *drafts.Detail) (*MadeFrom, error) {
	if d.GeneratedVersion == nil {
		return nil, nil
	}
	made := &MadeFrom{Facts: []madeFromFact{}, Knowledge: []madeFromArticle{}, PlanVersion: d.PlanVersion}
	for _, fact := range drafts.ReadFactsUsed(d.FactsUsed) {
		made.Facts = append(made.Facts, madeFromFact{Topic: fact.Topic, Label: drafts.TopicLabel(fact.Topic), Value: fact.Value})
	}
	titles := map[string]string{}
	if len(d.KnowledgeUsed) > 0 {
		rows, err := pool.Query(ctx, `SELECT id::text, title FROM knowledge_articles WHERE company_id = $1 AND id = ANY($2::uuid[])`, company.String(), d.KnowledgeUsed)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var id, title string
			if err := rows.Scan(&id, &title); err != nil {
				return nil, err
			}
			titles[id] = title
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	for _, id := range d.KnowledgeUsed {
		article := madeFromArticle{ArticleID: id}
		if title, found := titles[id]; found {
			article.Title = &title
		}
		made.Knowledge = append(made.Knowledge, article)
	}
	return made, nil
}
