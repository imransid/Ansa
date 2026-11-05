package devices

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/home"
	"ansa/core/internal/tenant"
)

// Status is what the app shows at the top: whose account, and what ansa
// does right now (the web Home's status card, read by the same code).
type Status struct {
	// The business's name, or the person's (a person's account is named after them).
	AccountName string `json:"accountName"`
	// "business" or "personal".
	Kind string `json:"kind"`
	// "available", "away" or "paused" (ansa answers nobody).
	State string `json:"state"`
	// Why away: "you" (someone pressed "I'm away"), "phone" (no phone was
	// reachable), "hours" (one of the away hours), or "".
	AwayBy string `json:"awayBy"`
	// When away began (RFC 3339), or "" (not away, or away by the hours).
	Since string `json:"since"`
	// ansa answers everyone anyway (a business answering always).
	AnswersAlways bool `json:"answersAlways"`
	FollowPhone   bool `json:"followPhone"`
	WaitMinutes   int  `json:"waitMinutes"`
}

// ReadStatus reads the company's status at this moment.
func ReadStatus(ctx context.Context, pool *database.Pool, company tenant.CompanyID, now time.Time) (Status, error) {
	// The role only decides whether Home offers the switches: not shown here.
	presence, err := home.ReadPresence(ctx, pool, company, "owner", now)
	if err != nil {
		return Status{}, err
	}
	status := Status{Kind: presence.Kind, AwayBy: presence.AwayBy, AnswersAlways: presence.AnswerWhen == "always",
		FollowPhone: presence.FollowPhone, WaitMinutes: presence.PhoneWaitMinutes}
	if err := pool.QueryRow(ctx, `SELECT name FROM companies WHERE id = $1`, company.String()).Scan(&status.AccountName); err != nil {
		return Status{}, err
	}
	switch {
	case presence.Status == "paused":
		status.State = "paused"
	case presence.AwayNow:
		status.State = "away"
	default:
		status.State = "available"
	}
	if presence.AwayBy == "you" || presence.AwayBy == "phone" {
		status.Since = rfc3339(presence.AwaySince)
	}
	return status, nil
}
