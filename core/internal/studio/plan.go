package studio

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// The current marketing plan as the content studio reads it (the old
// services/content-generation-inputs.ts readCurrentPlan): the newest
// version's positioning, audiences, pillars and campaigns. Read with SQL
// here on purpose: the strategy module owns writing plans.

// Plan is what the studio reads of the newest plan.
type Plan struct {
	Version     int
	Positioning string         `json:"positioning"`
	Audiences   []planAudience `json:"audiences"`
	Pillars     []planPillar   `json:"pillars"`
	Campaigns   []planCampaign `json:"campaigns"`
}

type planAudience struct {
	Name         string `json:"name"`
	Needs        string `json:"needs"`
	WhereToReach string `json:"where_to_reach"`
}

type planPillar struct {
	Name          string   `json:"name"`
	Description   string   `json:"description"`
	ExampleTopics []string `json:"example_topics"`
}

type planCampaign struct {
	Name         string `json:"name"`
	Objective    string `json:"objective"`
	Timing       string `json:"timing"`
	CallToAction string `json:"call_to_action"`
}

// PlanChoices are the current plan's pillar and campaign names, for the
// forms' menus (none without a plan).
type PlanChoices struct {
	PlanVersion *int     `json:"planVersion"`
	Pillars     []string `json:"pillars"`
	Campaigns   []string `json:"campaigns"`
}

// readCurrentPlan is one company's newest plan (nil: none, or one stored
// in a shape this code can't read).
func readCurrentPlan(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (*Plan, error) {
	var version int
	var stored []byte
	err := pool.QueryRow(ctx, `SELECT version, plan FROM marketing_plans WHERE company_id = $1 ORDER BY version DESC LIMIT 1`, company.String()).Scan(&version, &stored)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var plan Plan
	if json.Unmarshal(stored, &plan) != nil || plan.Positioning == "" || len(plan.Pillars) == 0 {
		return nil, nil
	}
	plan.Version = version
	return &plan, nil
}

// choicesOf is a plan's pillar and campaign names.
func choicesOf(plan *Plan) PlanChoices {
	choices := PlanChoices{Pillars: []string{}, Campaigns: []string{}}
	if plan == nil {
		return choices
	}
	choices.PlanVersion = &plan.Version
	for _, pillar := range plan.Pillars {
		choices.Pillars = append(choices.Pillars, pillar.Name)
	}
	for _, campaign := range plan.Campaigns {
		choices.Campaigns = append(choices.Campaigns, campaign.Name)
	}
	return choices
}

// sameName: a name picked from the plan matches its pillar or campaign
// whatever its case (a newer plan may have changed it).
func sameName(planName, picked string) bool {
	return strings.EqualFold(strings.TrimSpace(planName), strings.TrimSpace(picked))
}
