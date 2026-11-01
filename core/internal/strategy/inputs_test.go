package strategy

import (
	"context"
	"testing"

	"ansa/core/internal/profile"
)

const storedInputJSON = `{"period":{"days":30,"start":"2026-10-01T00:00:00.000Z","end":"2026-10-31T00:00:00.000Z"},"timeZone":"Europe/Rome","postCount":6,"postsLeftOut":0,"simulated":false,
	"posts":[{"label":"P1","platform":"facebook","format":"post","pillar":"Bread","topic":"Our sourdough","weekday":"Tuesday","hour":"09:00","simulated":false,"numbers":{"reactions":12}}],
	"groups":[{"label":"G1","kind":"pillar","name":"Bread","numbers":{"posts":4,"reactions_per_post":3.5}}]}`

const storedReviewJSON = `{"findings":[{"text":"Bread posts did best","evidence":[{"post_label":"P1","group":"","metric":"reactions","value":12},{"post_label":"","group":"G1","metric":"reactions_per_post","value":3.5}]}],
	"recommendations":[{"text":"Post more about bread","based_on_findings":[1]}],"limits_of_this_data":["Few posts"]}`

func TestSupportTrendsOnlyWhileOnAndTheNewestReviewReachThePlanner(t *testing.T) {
	w := newPlanWorld(t)
	ctx := context.Background()
	w.confirm(t, map[string]string{"description": "We bake.", "services": "Catering", "target_customers": "Offices"})
	w.mustExec(t, `INSERT INTO categories (company_id, name) VALUES ($1, 'Orders'), ($1, 'Complaints')`, w.company.String())
	for _, category := range []string{"Orders", "Orders", "Complaints"} {
		w.mustExec(t, `INSERT INTO tickets (company_id, ticket_number, subject, description, channel, category)
			VALUES ($1, (SELECT COALESCE(max(ticket_number), 0) + 1 FROM tickets WHERE company_id = $1), 'Where is my order?', 'Customer text', 'manual', $2)`, w.company.String(), category)
	}
	if uses, _ := UsesSupportTrends(ctx, w.pool, w.company); uses {
		t.Fatal("the setting is off by default")
	}
	facts, _ := profile.ReadFacts(ctx, w.pool, w.company)
	off, _ := GatherInputs(ctx, w.pool, w.company, facts, "")
	if _, sent := off.Request["support_trends"]; sent || off.UsedSupportTrends {
		t.Fatal("nothing of support while the setting is off")
	}
	if outcome, _ := SetSupportTrends(ctx, w.pool, w.company, w.owner, true); outcome != profile.Changed {
		t.Fatalf("turning it on: %s", outcome)
	}
	if outcome, _ := SetSupportTrends(ctx, w.pool, w.company, w.owner, true); outcome != profile.Unchanged {
		t.Fatalf("on again: %s", outcome)
	}
	w.mustExec(t, `INSERT INTO performance_reviews (company_id, period_start, period_end, input_summary, review, created_by_user_id)
		VALUES ($1, '2026-10-01', '2026-10-31', $2::jsonb, $3::jsonb, $4)`, w.company.String(), storedInputJSON, storedReviewJSON, w.owner)
	on, err := GatherInputs(ctx, w.pool, w.company, facts, "")
	if err != nil || !on.UsedSupportTrends || on.PerformanceReviewID == "" {
		t.Fatalf("on: %+v %v", on, err)
	}
	trends := on.Request["support_trends"].([]Trend)
	if len(trends) != 2 || trends[0] != (Trend{Category: "Orders", Tickets: 2}) || trends[1] != (Trend{Category: "Complaints", Tickets: 1}) {
		t.Fatalf("category names and counts only: %v", trends)
	}
	past := on.Request["past_performance"].(*PastPerformance)
	numbers := past.Findings[0].Numbers
	if past.PostsFrom != "2026-10-01" || past.PostsWithNumbers != 6 || numbers[0].Post == nil || numbers[0].Post.Topic != "Our sourdough" ||
		numbers[1].Group == nil || numbers[1].Group.Posts != 4 || past.Recommendations[0] != "Post more about bread" || past.Limits[0] != "Few posts" {
		t.Fatalf("the review as the brain gets it: %+v", past)
	}
	w.mustExec(t, `UPDATE performance_reviews SET review = '{"findings": [], "other": 1}'::jsonb WHERE company_id = $1`, w.company.String())
	if unreadable, _ := GatherInputs(ctx, w.pool, w.company, facts, ""); unreadable.PerformanceReviewID != "" || unreadable.Request["past_performance"] != nil {
		t.Fatal("a review this code can't read is left out")
	}
	w.answerWith(goodPlan(func(p map[string]any) { p["campaigns"] = "not a list" }))
	if result, _ := w.planner.Make(ctx, w.company, w.owner, ""); result.Outcome != NoPlan || result.Problem != ProblemUnusable {
		t.Fatalf("an unusable plan saves nothing: %+v", result)
	}
	if result, _ := w.planner.Make(ctx, w.company, w.owner, ""); result.Problem != ProblemFailed || countRows(t, w, `SELECT count(*) FROM marketing_plans WHERE company_id = $1`) != 0 {
		t.Fatalf("a failed plan saves nothing: %+v", result)
	}
}
