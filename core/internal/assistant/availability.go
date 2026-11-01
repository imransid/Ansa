package assistant

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/hours"
	"ansa/core/internal/tenant"
)

// Availability is when the assistant answers (the old lib/assistant/availability.ts):
// "always" (a business's default), or "when_away": while you said you're
// away, during your weekly away hours, or once you didn't answer yourself
// within ReplyGraceMinutes (nil: never).
type Availability struct {
	AnswerWhen        string
	AwaySince         *time.Time
	AwayHours         []byte
	TimeZone          *string
	ReplyGraceMinutes *int
}

// What to do with a message that just arrived.
const (
	CoverAnswer = "answer"
	CoverWait   = "wait"
	CoverLeave  = "leave"
)

// DecideCover answers now, waits to see whether you answer first (with the
// minutes), or leaves the message to you.
func DecideCover(a Availability, now time.Time) (string, int) {
	if a.AnswerWhen != "when_away" || IsAwayNow(a, now) {
		return CoverAnswer, 0
	}
	if a.ReplyGraceMinutes != nil && *a.ReplyGraceMinutes > 0 {
		return CoverWait, *a.ReplyGraceMinutes
	}
	return CoverLeave, 0
}

// IsAwayNow: you said you're away, or it is one of your away hours.
func IsAwayNow(a Availability, now time.Time) bool {
	if a.AwaySince != nil {
		return true
	}
	if a.TimeZone == nil {
		return false
	}
	week, ok := hours.Parse(a.AwayHours)
	zone, err := time.LoadLocation(*a.TimeZone)
	if !ok || err != nil {
		return false
	}
	open, _ := hours.Now(week, zone, now)
	return open
}

// ReadAvailability reads the company's settings (none saved: always answer).
func ReadAvailability(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (Availability, error) {
	const statement = `SELECT answer_when, away_since, away_hours, time_zone, reply_grace_minutes FROM assistant_settings WHERE company_id = $1`
	a := Availability{AnswerWhen: "always"}
	err := pool.QueryRow(ctx, statement, company.String()).Scan(&a.AnswerWhen, &a.AwaySince, &a.AwayHours, &a.TimeZone, &a.ReplyGraceMinutes)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, nil
	}
	return a, err
}

// ScheduleCheck lets you answer yourself first: the catch-up looks at this
// conversation again in `minutes`. A conversation already waiting keeps its
// earlier time.
func ScheduleCheck(ctx context.Context, pool *database.Pool, company tenant.CompanyID, conversationID string, minutes int) error {
	const statement = `
		UPDATE conversations SET assistant_due_at = now() + make_interval(mins => $3)
		WHERE company_id = $1 AND id = $2 AND assistant_due_at IS NULL`
	_, err := pool.Exec(ctx, statement, company.String(), conversationID, minutes)
	return err
}
