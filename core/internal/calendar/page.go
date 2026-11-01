package calendar

import (
	"context"
	"sort"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

const (
	// The calendar's weeks (the browser keeps the days of the viewer's own time zone).
	calendarDays = 28
	// The calendar reads at most this many of each kind.
	calendarItemsMax = 500
)

// Item is one thing on the calendar: a post on its way (or out) to an
// account, or a draft or idea planned for a day.
type Item struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
	// When: the browser puts it on the viewer's own day.
	At          time.Time `json:"at"`
	DraftID     string    `json:"draftId"`
	Topic       string    `json:"topic"`
	Platform    string    `json:"platform"`
	Format      string    `json:"format"`
	Status      string    `json:"status"`
	AccountName *string   `json:"accountName"`
}

// Page is the calendar page (the old CalendarPage): its items, the current
// plan's version (nil: none), and whether this person may plan with the AI.
type Page struct {
	Items       []Item `json:"items"`
	PlanVersion *int   `json:"planVersion"`
	CanPlan     bool   `json:"canPlan"`
}

// ReadPage reads one company's posts and planned drafts from a day before
// now to a day past the calendar's weeks.
func ReadPage(ctx context.Context, pool *database.Pool, company tenant.CompanyID, canPlan bool, now time.Time) (Page, error) {
	page := Page{Items: []Item{}, CanPlan: canPlan}
	from, to := now.Add(-24*time.Hour), now.Add((calendarDays+1)*24*time.Hour)
	posts, err := PostsBetween(ctx, pool, company, from, to, calendarItemsMax)
	if err != nil {
		return page, err
	}
	drafts, err := PlannedDraftsBetween(ctx, pool, company, from, to, calendarItemsMax)
	if err != nil {
		return page, err
	}
	for _, post := range posts {
		page.Items = append(page.Items, itemOf("job", post))
	}
	for _, draft := range drafts {
		page.Items = append(page.Items, itemOf("draft", draft))
	}
	sort.SliceStable(page.Items, func(i, j int) bool { return page.Items[i].At.Before(page.Items[j].At) })
	plan, version, err := CurrentPlan(ctx, pool, company)
	if plan != nil {
		page.PlanVersion = &version
	}
	return page, err
}

func itemOf(kind string, p Planned) Item {
	return Item{Kind: kind, ID: p.ID, At: p.At.UTC(), DraftID: p.DraftID, Topic: p.Topic, Platform: p.Platform, Format: p.Format, Status: p.Status, AccountName: p.AccountName}
}
