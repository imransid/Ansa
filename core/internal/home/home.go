// Package home is Home's reads (the old services/away.ts, services/home.ts,
// db/away-summary.ts): what ansa is doing right now, what it did while you
// were away, what an owner still has to set up, and who needs a person.
package home

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/assistant"
	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Presence is what ansa does right now, for the status card.
type Presence struct {
	// "business" or "personal".
	Kind string `json:"kind"`
	// "on" or "paused" (ansa answers nobody).
	Status     string `json:"status"`
	AnswerWhen string `json:"answerWhen"`
	AwayNow    bool   `json:"awayNow"`
	// "I'm away" since (nil: not pressed), and the minutes ansa waits for
	// you before answering (nil: never): the status card's two kinds of away.
	AwaySince         *time.Time `json:"awaySince"`
	ReplyGraceMinutes *int       `json:"replyGraceMinutes"`
	// A few words: "You're away: ansa answers".
	CoverText string `json:"coverText"`
	// Owners change it; members read it.
	CanManage bool `json:"canManage"`
	// Why ansa is away now: "you" (someone pressed "I'm away"), "phone" (none
	// of the owners' connected phones was reachable: awaySince is when that
	// began), "hours" (one of the away hours), or "" (not away).
	AwayBy string `json:"awayBy"`
	// The phone app (core/internal/devices): ansa switches to away by itself
	// when no connected phone has checked in for phoneWaitMinutes.
	FollowPhone      bool `json:"followPhone"`
	PhoneWaitMinutes int  `json:"phoneWaitMinutes"`
}

// ReadPresence reads the company's switch and when ansa answers.
func ReadPresence(ctx context.Context, pool *database.Pool, company tenant.CompanyID, role string, now time.Time) (Presence, error) {
	p := Presence{Status: "on", CanManage: role == "owner"}
	if err := pool.QueryRow(ctx, `SELECT kind FROM companies WHERE id = $1`, company.String()).Scan(&p.Kind); err != nil {
		return p, err
	}
	p.PhoneWaitMinutes = 5
	awaySetBy := ""
	const settings = `SELECT status, COALESCE(away_set_by, ''), follow_phone, phone_wait_minutes FROM assistant_settings WHERE company_id = $1`
	err := pool.QueryRow(ctx, settings, company.String()).Scan(&p.Status, &awaySetBy, &p.FollowPhone, &p.PhoneWaitMinutes)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return p, err
	}
	availability, err := assistant.ReadAvailability(ctx, pool, company)
	if err != nil {
		return p, err
	}
	p.AnswerWhen = availability.AnswerWhen
	p.AwayNow = assistant.IsAwayNow(availability, now)
	p.AwaySince, p.ReplyGraceMinutes = availability.AwaySince, availability.ReplyGraceMinutes
	p.CoverText = describeCover(availability, p.AwayNow)
	p.AwayBy = awayBy(availability.AwaySince != nil, awaySetBy, p.AwayNow)
	return p, nil
}

// awayBy says why ansa is away now. An away set before the phone app has
// no away_set_by: a person's.
func awayBy(awaySinceSet bool, setBy string, awayNow bool) string {
	switch {
	case awaySinceSet && setBy == "phone":
		return "phone"
	case awaySinceSet:
		return "you"
	case awayNow:
		return "hours"
	}
	return ""
}

// describeCover is the old describeCover: a few words for the sidebar and Home.
func describeCover(a assistant.Availability, awayNow bool) string {
	switch {
	case a.AnswerWhen != "when_away":
		return "ansa answers every message"
	case awayNow:
		return "You're away: ansa answers"
	case a.ReplyGraceMinutes != nil && *a.ReplyGraceMinutes > 0:
		return "You're available: ansa answers after " + strconv.Itoa(*a.ReplyGraceMinutes) + " min"
	}
	return "You're available: you answer"
}
