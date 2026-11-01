package home

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/assistant"
	"ansa/core/internal/database"
	"ansa/core/internal/hours"
	"ansa/core/internal/tenant"
)

// Glance is the sidebar's foot (the old getAssistantGlanceForSession and
// getDashboardSummary): the company's name, what ansa does right now, and
// today's hours in the business's own time zone (nil: none set).
type Glance struct {
	CompanyName string      `json:"companyName"`
	Mode        string      `json:"mode"`
	Hours       *GlanceHour `json:"hours"`
}

// GlanceHour is "Open until 23:00" and whether it is open now.
type GlanceHour struct {
	Open bool   `json:"open"`
	Text string `json:"text"`
}

// ReadGlance reads the glance at this moment.
func ReadGlance(ctx context.Context, pool *database.Pool, company tenant.CompanyID, now time.Time) (Glance, error) {
	var g Glance
	if err := pool.QueryRow(ctx, `SELECT name FROM companies WHERE id = $1`, company.String()).Scan(&g.CompanyName); err != nil {
		return g, err
	}
	status, replyMode := "on", "automatic"
	var openingHours []byte
	var timeZone *string
	const settings = `SELECT status::text, reply_mode::text, opening_hours, time_zone FROM assistant_settings WHERE company_id = $1`
	err := pool.QueryRow(ctx, settings, company.String()).Scan(&status, &replyMode, &openingHours, &timeZone)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return g, err
	}
	availability, err := assistant.ReadAvailability(ctx, pool, company)
	if err != nil {
		return g, err
	}
	g.Mode = glanceMode(status, replyMode, availability, now)
	if week, ok := hours.Parse(openingHours); ok && timeZone != nil {
		if zone, err := time.LoadLocation(*timeZone); err == nil {
			open, text := hours.Now(week, zone, now)
			g.Hours = &GlanceHour{Open: open, Text: text}
		}
	}
	return g, nil
}

// glanceMode is "Paused", whether ansa answers for you now (when it
// answers only while you're away), else the reply mode.
func glanceMode(status, replyMode string, availability assistant.Availability, now time.Time) string {
	switch {
	case status == "paused":
		return "Paused"
	case availability.AnswerWhen == "when_away" && assistant.IsAwayNow(availability, now):
		return "Away: ansa answers for you"
	case availability.AnswerWhen == "when_away":
		return "Available: you answer"
	case replyMode == "automatic":
		return "Answers on its own"
	}
	return "Asks you first"
}
