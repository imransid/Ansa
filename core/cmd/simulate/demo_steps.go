package main

import (
	"context"
	"fmt"
	"time"

	"ansa/core/internal/commands"
	"ansa/core/internal/hours"
	"ansa/core/internal/settings"
	"ansa/core/internal/setup"
)

// demoStep is one save of a demo account's setup: what it is, and the save.
type demoStep struct {
	what string
	save func() (string, error)
}

// runSteps runs the saves in order and stops at the first refused one.
func runSteps(steps []demoStep) error {
	for _, step := range steps {
		outcome, err := step.save()
		if err := saved(step.what, outcome, err); err != nil {
			return err
		}
	}
	return nil
}

// saveSetup saves each setup step the account's kind has (a person has no
// contact or orders step; their week is when they're away), finishes the
// setup and picks the free AI engine on this computer (development only).
func saveSetup(ctx context.Context, w *world, a demoAccount, business *setup.Business, contact *setup.Contact, week *setup.Week, orders *setup.Orders, answering *setup.Answering) error {
	kind := business.Kind
	typed, problems := week.Check(kind == "personal")
	for section, sectionProblems := range map[string]setup.Fields{"business": business.Check(), "hours": problems, "assistant": answering.Check()} {
		if err := checked(section, sectionProblems); err != nil {
			return err
		}
	}
	steps := []demoStep{{"business details", func() (string, error) {
		return setup.SaveBusiness(ctx, w.pool, a.company, a.userID, *business, setup.StepNumber("business", kind))
	}}}
	if contact != nil {
		if err := checked("contact", contact.Check()); err != nil {
			return err
		}
		steps = append(steps, demoStep{"contact", func() (string, error) {
			return setup.SaveContact(ctx, w.pool, a.company, a.userID, *contact, setup.StepNumber("contact", kind))
		}})
	}
	if kind == "personal" {
		steps = append(steps, demoStep{"away hours", func() (string, error) {
			return setup.SaveAway(ctx, w.pool, a.company, a.userID, week.TimeZone, typed, week.ReplyGraceMinutes, setup.StepNumber("away", kind))
		}})
	} else {
		steps = append(steps, demoStep{"opening hours", func() (string, error) {
			return setup.SaveHours(ctx, w.pool, a.company, a.userID, week.TimeZone, typed, setup.StepNumber("hours", kind))
		}})
	}
	if orders != nil {
		if err := checked("orders", orders.Check()); err != nil {
			return err
		}
		steps = append(steps, demoStep{"orders", func() (string, error) {
			return setup.SaveOrders(ctx, w.pool, a.company, a.userID, *orders, setup.StepNumber("orders", kind))
		}})
	}
	steps = append(steps,
		demoStep{"assistant", func() (string, error) {
			return setup.SaveAnswering(ctx, w.pool, a.company, a.userID, *answering, setup.StepNumber("assistant", kind))
		}},
		demoStep{"connect step", func() (string, error) {
			return setup.RecordConnectDone(ctx, w.pool, a.company, a.userID, setup.StepNumber("connect", kind))
		}},
		demoStep{"setup", func() (string, error) { return setup.Finish(ctx, w.pool, a.company, a.userID) }},
		demoStep{"AI engine", func() (string, error) {
			return settings.SaveEngine(ctx, w.pool, a.company, a.userID, "claude_code", settings.KeyChange{})
		}},
	)
	return runSteps(steps)
}

// checked turns a section's problems into the tool's refusal.
func checked(section string, problems map[string]string) error {
	if len(problems) == 0 {
		return nil
	}
	return commands.Refusal(fmt.Sprintf("The demo's %s section has problems: %v", section, problems))
}

// everyDay is a week open from opens to closes every day.
func everyDay(opens, closes string) *setup.Week {
	week := map[string][]hours.Range{}
	for _, day := range []string{"mon", "tue", "wed", "thu", "fri", "sat", "sun"} {
		week[day] = []hours.Range{{Opens: opens, Closes: closes}}
	}
	return &setup.Week{TimeZone: "Asia/Dhaka", Hours: week}
}

// setReplyMode switches between Automatic and "Ask me first", keeping the
// rest of Settings → Assistant as it is.
func setReplyMode(ctx context.Context, w *world, a demoAccount, mode string) error {
	now, err := settings.Read(ctx, w.pool, a.company)
	if err != nil {
		return err
	}
	outcome, err := settings.SaveAssistant(ctx, w.pool, a.company, a.userID,
		settings.Assistant{Status: now.Status, ReplyMode: mode, Instructions: now.Instructions, HoldingReply: now.HoldingReply, AlertByEmail: now.AlertByEmail})
	return saved("reply mode", outcome, err)
}

// moveBack moves a conversation's history (its messages, ansa's activity,
// its requests and their history, its orders) back in time by one offset,
// as if it had happened then (development only): one offset keeps their
// order. More than a day back, its 24-hour reply window has closed.
func moveBack(ctx context.Context, w *world, a demoAccount, conversationID string, ago time.Duration) error {
	shift := fmt.Sprintf("%d seconds", int(ago.Seconds()))
	for _, statement := range []string{
		`UPDATE messages SET created_at = created_at - $3::interval WHERE company_id = $1 AND conversation_id = $2`,
		`UPDATE assistant_activity SET created_at = created_at - $3::interval WHERE company_id = $1 AND conversation_id = $2`,
		`UPDATE ticket_activity SET created_at = created_at - $3::interval
			WHERE company_id = $1 AND ticket_id IN (SELECT id FROM tickets WHERE company_id = $1 AND conversation_id = $2)`,
		`UPDATE tickets SET created_at = created_at - $3::interval, updated_at = updated_at - $3::interval WHERE company_id = $1 AND conversation_id = $2`,
		`UPDATE orders SET created_at = created_at - $3::interval, placed_at = placed_at - $3::interval, updated_at = updated_at - $3::interval
			WHERE company_id = $1 AND conversation_id = $2`,
		`UPDATE conversations SET created_at = created_at - $3::interval, last_activity_at = last_activity_at - $3::interval,
			last_customer_message_at = last_customer_message_at - $3::interval WHERE company_id = $1 AND id = $2`,
	} {
		if _, err := w.pool.Exec(ctx, statement, a.company.String(), conversationID, shift); err != nil {
			return err
		}
	}
	return nil
}

// spreadOverTheDay moves each customer's conversation back by its own time.
func spreadOverTheDay(ctx context.Context, w *world, a demoAccount, conversationOf map[string]string, ago map[string]time.Duration) error {
	for name, offset := range ago {
		if err := moveBack(ctx, w, a, conversationOf[name], offset); err != nil {
			return err
		}
	}
	return nil
}
