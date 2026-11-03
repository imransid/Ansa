package main

import (
	"context"
	"io"
	"time"

	"ansa/core/internal/calendar"
	"ansa/core/internal/knowledge"
	"ansa/core/internal/logging"
	"ansa/core/internal/menu"
	"ansa/core/internal/profile"
	"ansa/core/internal/socialconnect"
)

// Smaller pieces of the restaurant's demo (setUpRestaurant adds them): ideas
// on the calendar for the next two weeks, a dish not available today, the
// stand-in YouTube channel beside the other accounts, and a saved answer
// waiting for the owner's approval.
func addDemoExtras(ctx context.Context, w *world, a demoAccount) error {
	return runSteps([]demoStep{
		{"calendar ideas", func() (string, error) { return addCalendarIdeas(ctx, w, a) }},
		{"dish not available today", func() (string, error) { return markNotAvailableToday(ctx, w, a, "Shorshe Ilish") }},
		{"stand-in YouTube channel", func() (string, error) {
			accounts := &socialconnect.Connector{Pool: w.pool, Box: w.box, Log: logging.New(io.Discard), AppURL: w.cfg.AppURL, Development: true}
			return accounts.ConnectStandIn(ctx, a.company, a.userID, "youtube")
		}},
		{"saved answer waiting for approval", func() (string, error) {
			_, outcome, err := knowledge.CreateDrafts(ctx, w.pool, a.company, a.userID, []knowledge.Fields{{Title: "Delivery areas", Kind: "policy", UseForSupport: true,
				Body: "We deliver to Dhanmondi, Kalabagan, Lalmatia and Mohammadpur, in about 45 minutes. Further away, pick up or ask us first."}}, knowledge.Source{})
			if outcome == "created" {
				outcome = "saved"
			}
			return outcome, err
		}},
	})
}

// addCalendarIdeas plans post ideas on days of the next two weeks, as "Plan
// the next 2 weeks" saves them (nothing written, approved or scheduled).
func addCalendarIdeas(ctx context.Context, w *world, a demoAccount) (string, error) {
	dhaka, err := time.LoadLocation("Asia/Dhaka")
	if err != nil {
		return "", err
	}
	today := time.Now().In(dhaka)
	planned := []struct {
		inDays                            int
		platform, pillar, campaign, topic string
	}{
		{2, "facebook", "Dish of the day", "Office lunch weeks", "Beef bhuna for an office lunch"},
		{4, "facebook", "From our kitchen", "", "Our cooks at 9 in the morning"},
		{6, "linkedin", "Family and events", "Wedding season catering", "A winter wedding menu for 200 guests"},
		{9, "facebook", "Dish of the day", "Office lunch weeks", "Mishti doi, made in the kitchen"},
		{12, "facebook", "Family and events", "", "A family evening in the upstairs room"},
	}
	var ideas []calendar.Idea
	for _, p := range planned {
		day := time.Date(today.Year(), today.Month(), today.Day()+p.inDays, 11, 0, 0, 0, dhaka)
		ideas = append(ideas, calendar.Idea{PlannedFor: day, Post: calendar.Post{Date: day.Format("2006-01-02"), Time: "11:00",
			Platform: p.platform, Format: "post", Pillar: p.pillar, Campaign: p.campaign, Topic: p.topic}})
	}
	_, outcome, err := calendar.SaveIdeas(ctx, w.pool, a.company, a.userID, ideas)
	if outcome == profile.Saved {
		outcome = "saved"
	}
	return outcome, err
}

// markNotAvailableToday marks one dish "Not available today", as anyone in
// the restaurant does on the Menu page (it lasts until the restaurant's
// midnight).
func markNotAvailableToday(ctx context.Context, w *world, a demoAccount, name string) (string, error) {
	var itemID string
	if err := w.pool.QueryRow(ctx, `SELECT id::text FROM catalog_items WHERE company_id = $1 AND name = $2`, a.company.String(), name).Scan(&itemID); err != nil {
		return "", err
	}
	return menu.SetAvailable(ctx, w.pool, a.company, a.userID, itemID, false, time.Now())
}
