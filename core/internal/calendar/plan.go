package calendar

import (
	"context"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/profile"
	"ansa/core/internal/strategy"
	"ansa/core/internal/tenant"
)

// Planner plans the next two weeks with the brain. Never logs the plan,
// the topics, the request or the answer: fixed lines and class names only.
type Planner struct {
	Pool  *database.Pool
	Brain *brainclient.Client
	Log   *logging.Logger
}

const calendarPlanPath = "/v1/cofounder/calendar-plan"

// The most topics already planned the request names.
const alreadyPlannedShown = 100

// What planning ended in, besides profile.NotAllowed.
const (
	Planned2Weeks = "planned"
	NoCurrentPlan = "no-plan"
	// Nothing was added: why is in Problem.
	NothingAdded = "nothing-added"
)

// Why nothing was added, as the page words it.
const (
	ProblemUnavailable = "unavailable"
	ProblemUnusable    = "unusable"
	ProblemNoneFit     = "none-fit"
	ProblemFailed      = "failed"
)

// PlanResult is how many ideas were added, or why none were.
type PlanResult struct {
	Outcome string `json:"outcome"`
	Added   int    `json:"added"`
	Problem string `json:"problem,omitempty"`
}

// PlanTwoWeeks plans the 14 days from tomorrow in the owner's time zone
// as ideas, from the company's current marketing plan. Nothing is written,
// approved or scheduled. Without a usable answer nothing is saved.
func (p *Planner) PlanTwoWeeks(ctx context.Context, company tenant.CompanyID, actorUserID string, zone *time.Location, now time.Time) (PlanResult, error) {
	plan, _, err := CurrentPlan(ctx, p.Pool, company)
	if err != nil || plan == nil {
		return PlanResult{Outcome: NoCurrentPlan}, err
	}
	asked, request, err := p.gather(ctx, company, plan, zone, now)
	if err != nil {
		return PlanResult{}, err
	}
	var answer struct {
		profile.BrainFailure
		Posts []Post `json:"posts"`
	}
	err = p.Brain.Call(ctx, calendarPlanPath, request, &answer)
	profile.LogFailure(p.Log, "calendar plan: the AI failed", answer.BrainFailure, err)
	switch {
	case err != nil || answer.Reason == "model_failed":
		return PlanResult{Outcome: NothingAdded, Problem: ProblemFailed}, nil
	case answer.Unavailable():
		return PlanResult{Outcome: NothingAdded, Problem: ProblemUnavailable}, nil
	case answer.Kind != "ok":
		return PlanResult{Outcome: NothingAdded, Problem: ProblemUnusable}, nil
	}
	var ideas []Idea
	for _, post := range KeepPosts(answer.Posts, asked) {
		if at, ok := WallClock(post.Date, post.Time, zone); ok {
			ideas = append(ideas, Idea{Post: post, PlannedFor: at})
		}
	}
	if len(ideas) == 0 {
		return PlanResult{Outcome: NothingAdded, Problem: ProblemNoneFit}, nil
	}
	added, outcome, err := SaveIdeas(ctx, p.Pool, company, actorUserID, ideas)
	if err != nil || outcome != profile.Saved {
		return PlanResult{Outcome: outcome}, err
	}
	return PlanResult{Outcome: Planned2Weeks, Added: added}, nil
}

// gather is the request: the 14 days from tomorrow in the owner's time
// zone, each platform's target, the plan's pillars and campaigns, and the
// topics planned or scheduled on those days already. No fact, account or id.
func (p *Planner) gather(ctx context.Context, company tenant.CompanyID, plan *strategy.Plan, zone *time.Location, now time.Time) (Asked, map[string]any, error) {
	today := LocalDate(now, zone)
	asked := Asked{Targets: PlanTargets(plan.Cadence), Pillars: []string{}, Campaigns: []string{}, PlannedTopics: []string{}}
	dates := []map[string]string{}
	for day := 1; day <= planningDays; day++ {
		date := AddDays(today, day)
		asked.Dates = append(asked.Dates, date)
		dates = append(dates, map[string]string{"date": date, "weekday": Weekday(date)})
	}
	from, _ := WallClock(asked.Dates[0], "00:00", zone)
	to, _ := WallClock(AddDays(asked.Dates[planningDays-1], 1), "00:00", zone)
	drafts, err := PlannedDraftsBetween(ctx, p.Pool, company, from, to, alreadyPlannedShown)
	if err != nil {
		return asked, nil, err
	}
	posts, err := PostsBetween(ctx, p.Pool, company, from, to, alreadyPlannedShown)
	if err != nil {
		return asked, nil, err
	}
	already := []map[string]string{}
	for _, planned := range append(drafts, posts...) {
		if len(already) < alreadyPlannedShown {
			already = append(already, map[string]string{"date": LocalDate(planned.At, zone), "platform": planned.Platform, "topic": planned.Topic})
			asked.PlannedTopics = append(asked.PlannedTopics, planned.Topic)
		}
	}
	for _, pillar := range plan.Pillars {
		asked.Pillars = append(asked.Pillars, pillar.Name)
	}
	campaigns := []map[string]any{}
	for _, campaign := range plan.Campaigns {
		asked.Campaigns = append(asked.Campaigns, campaign.Name)
		campaigns = append(campaigns, map[string]any{"name": campaign.Name, "objective": campaign.Objective, "pillar": campaign.Pillar, "platforms": campaign.Platforms, "timing": campaign.Timing})
	}
	request := map[string]any{"targets": asked.Targets, "dates": dates, "pillars": plan.Pillars, "campaigns": campaigns, "already_planned": already}
	return asked, request, nil
}
