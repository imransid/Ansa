package publishing

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/tenant"
)

// A usable marketing plan has at least 3 content pillars and keeps at most
// 6 (the old PLAN_LIST_LIMITS.pillars).
const (
	planPillarsMin = 3
	planPillarsMax = 6
)

// CurrentPlanPillars are the content pillars of the company's newest
// marketing plan, by name, as the plan wrote them (a rule and a draft name
// a pillar the same way). Empty without a plan, or when its pillars can't
// be read (the old page then had no plan to offer either). Only the
// pillars are read here: the plan itself moves with the strategy page.
func CurrentPlanPillars(ctx context.Context, q rowReader, company tenant.CompanyID) ([]string, error) {
	var stored []byte
	err := q.QueryRow(ctx, `SELECT plan FROM marketing_plans WHERE company_id = $1 ORDER BY version DESC LIMIT 1`, company.String()).Scan(&stored)
	if errors.Is(err, pgx.ErrNoRows) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	var plan struct {
		Pillars []struct {
			Name *string `json:"name"`
		} `json:"pillars"`
	}
	if json.Unmarshal(stored, &plan) != nil || len(plan.Pillars) < planPillarsMin {
		return []string{}, nil
	}
	names := []string{}
	for _, pillar := range plan.Pillars[:min(len(plan.Pillars), planPillarsMax)] {
		if pillar.Name == nil || strings.TrimSpace(*pillar.Name) == "" {
			return []string{}, nil
		}
		names = append(names, strings.TrimSpace(*pillar.Name))
	}
	return names, nil
}

// PlanPillarNamed is the current plan's pillar a typed name means (any
// case, spaces around it aside), as the plan spells it, or "" when the plan
// has none of that name.
func PlanPillarNamed(pillars []string, typed string) string {
	wanted := strings.ToLower(strings.TrimSpace(typed))
	for _, pillar := range pillars {
		if strings.ToLower(strings.TrimSpace(pillar)) == wanted {
			return pillar
		}
	}
	return ""
}
