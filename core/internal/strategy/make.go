package strategy

import (
	"context"
	"encoding/json"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/profile"
	"ansa/core/internal/tenant"
)

// Planner makes marketing plans with the brain (the old
// services/marketing-plan.ts). A plan the AI couldn't write, or wrote in a
// shape core can't use, saves nothing. Never logs the facts, the articles,
// the note, the request or the answer: fixed lines and class names only.
type Planner struct {
	Pool  *database.Pool
	Brain *brainclient.Client
	Log   *logging.Logger
}

const marketingPlanPath = "/v1/cofounder/marketing-plan"

// What making a plan ended in, besides profile.NotAllowed.
const (
	Made = "made"
	// What a plan needs isn't confirmed: the AI was never asked.
	NotReady = "not-ready"
	// No plan came back: why is in Problem.
	NoPlan = "no-plan"
)

// Why no plan came back, as the page words it.
const (
	ProblemUnavailable = "unavailable"
	ProblemUnusable    = "unusable"
	ProblemFailed      = "failed"
)

// MakeResult is a new version's number, or why there is none.
type MakeResult struct {
	Outcome string        `json:"outcome"`
	Version int           `json:"version,omitempty"`
	Missing []MissingFact `json:"missing,omitempty"`
	Problem string        `json:"problem,omitempty"`
}

// MissingNow is what a plan of this company still needs (none: ready).
func MissingNow(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]MissingFact, error) {
	facts, err := profile.ReadFacts(ctx, pool, company)
	if err != nil {
		return nil, err
	}
	return MissingForPlan(facts.ConfirmedTopics()), nil
}

// Make makes a new version of one company's plan with the brain, and
// saves it while actorUserID is still an active owner. goalNote: what the
// owner asked it to focus on ("" = nothing).
func (p *Planner) Make(ctx context.Context, company tenant.CompanyID, actorUserID, goalNote string) (MakeResult, error) {
	facts, err := profile.ReadFacts(ctx, p.Pool, company)
	if err != nil {
		return MakeResult{}, err
	}
	// Without these the AI could only guess, so it isn't asked.
	if missing := MissingForPlan(facts.ConfirmedTopics()); len(missing) > 0 {
		return MakeResult{Outcome: NotReady, Missing: missing}, nil
	}
	inputs, err := GatherInputs(ctx, p.Pool, company, facts, goalNote)
	if err != nil {
		return MakeResult{}, err
	}
	var answer struct {
		profile.BrainFailure
		Plan json.RawMessage `json:"plan"`
	}
	err = p.Brain.Call(ctx, marketingPlanPath, inputs.Request, &answer)
	profile.LogFailure(p.Log, "marketing plan: the AI failed", answer.BrainFailure, err)
	switch {
	case err != nil || answer.Reason == "model_failed":
		return MakeResult{Outcome: NoPlan, Problem: ProblemFailed}, nil
	case answer.Unavailable():
		return MakeResult{Outcome: NoPlan, Problem: ProblemUnavailable}, nil
	}
	sent := map[string]bool{}
	for _, fact := range inputs.Facts {
		sent[fact.Topic] = true
	}
	plan, ok := ReadPlan(answer.Plan, sent)
	if answer.Kind != "ok" || !ok {
		return MakeResult{Outcome: NoPlan, Problem: ProblemUnusable}, nil
	}
	version, outcome, err := SavePlan(ctx, p.Pool, company, actorUserID, NewPlan{
		GoalNote: goalNote, Plan: plan, FactsUsed: inputs.Facts, KnowledgeUsed: inputs.KnowledgeUsed,
		UsedSupportTrends: inputs.UsedSupportTrends, PerformanceReviewID: inputs.PerformanceReviewID,
	})
	if err != nil || outcome != profile.Saved {
		return MakeResult{Outcome: outcome}, err
	}
	return MakeResult{Outcome: Made, Version: version}, nil
}
