package setup

import (
	"context"
	"encoding/json"
	"regexp"
	"slices"
	"unicode/utf8"

	"ansa/core/internal/database"
	"ansa/core/internal/hours"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/settings"
	"ansa/core/internal/tenant"
)

// Fields are a form's problems, by field, in words for people.
type Fields map[string]string

// Contact is step 2: the address customers come to, and the number they may call.
type Contact struct {
	Address string `json:"address"`
	Phone   string `json:"phone"`
}

var phonePattern = regexp.MustCompile(`^[0-9+()\-. ]*$`)

// Check cleans the section and says what is wrong.
func (c *Contact) Check() Fields {
	fields := Fields{}
	c.Address = plaintext.SingleLine(c.Address)
	switch {
	case c.Address == "":
		fields["address"] = "Give the address customers come to, or the area you serve."
	case utf8.RuneCountInString(c.Address) > 300:
		fields["address"] = "At most 300 characters."
	}
	c.Phone = plaintext.SingleLine(c.Phone)
	switch {
	case utf8.RuneCountInString(c.Phone) > 40:
		fields["phone"] = "At most 40 characters."
	case !phonePattern.MatchString(c.Phone):
		fields["phone"] = "Use digits, spaces and + ( ) - only."
	}
	return fields
}

// SaveContact saves step 2 (the address is the "location" business fact).
func SaveContact(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, c Contact, reached int) (string, error) {
	return settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		if err := SetOwnerFactWithin(ctx, tx, company, actorUserID, "location", c.Address); err != nil {
			return err
		}
		var phone *string
		if c.Phone != "" {
			phone = &c.Phone
		}
		const upsert = `
			INSERT INTO assistant_settings (company_id, public_phone, updated_by_user_id) VALUES ($1, $2, $3)
			ON CONFLICT (company_id) DO UPDATE SET public_phone = $2, updated_by_user_id = $3, updated_at = now()`
		if _, err := tx.Exec(ctx, upsert, company.String(), phone, actorUserID); err != nil {
			return err
		}
		return recordProgressWithin(ctx, tx, company, reached)
	})
}

// Week is a section of weekly times as typed, with its time zone: opening
// hours (step 3) or a person's away hours.
type Week struct {
	TimeZone string                   `json:"timeZone"`
	Hours    map[string][]hours.Range `json:"hours"`
	// Away hours only: how long ansa waits for the person (nil: never steps in).
	ReplyGraceMinutes *int `json:"replyGraceMinutes"`
}

// Check reads every day as the old form did; problems are by day.
func (w *Week) Check(away bool) (hours.Week, Fields) {
	week, problems := hours.ReadWeek(w.Hours)
	fields := Fields(problems)
	if !hours.KnownTimeZone(w.TimeZone) {
		fields["timeZone"] = "Choose a time zone from the list."
	}
	if g := w.ReplyGraceMinutes; away && g != nil && !slices.Contains([]int{5, 10, 15, 30, 60}, *g) {
		fields["replyGraceMinutes"] = "Choose how long ansa waits."
	}
	// WHY: opening hours with no time on any day are "closed every day", and
	// ansa would tell every customer so. Empty away hours are fine: the
	// person answers themselves.
	if !away && len(problems) == 0 && closedEveryDay(week) {
		fields["hours"] = "Set the times you're open (empty days are closed): with none, ansa tells customers you're closed every day."
	}
	return week, fields
}

// closedEveryDay is true for a week without a time on any day.
func closedEveryDay(week hours.Week) bool {
	for _, ranges := range week {
		if len(ranges) > 0 {
			return false
		}
	}
	return true
}

// SaveHours saves the opening hours and their time zone (step 3).
func SaveHours(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, timeZone string, week hours.Week, reached int) (string, error) {
	stored, _ := json.Marshal(week)
	return settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const upsert = `
			INSERT INTO assistant_settings (company_id, time_zone, opening_hours, updated_by_user_id) VALUES ($1, $2, $3::jsonb, $4)
			ON CONFLICT (company_id) DO UPDATE SET time_zone = $2, opening_hours = $3::jsonb, updated_by_user_id = $4, updated_at = now()`
		if _, err := tx.Exec(ctx, upsert, company.String(), timeZone, string(stored), actorUserID); err != nil {
			return err
		}
		return recordProgressWithin(ctx, tx, company, reached)
	})
}

// SaveAway saves a person's away hours, their time zone and the minutes
// ansa waits (a person's step 2, and Settings → Assistant).
func SaveAway(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, timeZone string, week hours.Week, grace *int, reached int) (string, error) {
	stored, _ := json.Marshal(week)
	return settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const upsert = `
			INSERT INTO assistant_settings (company_id, time_zone, away_hours, reply_grace_minutes, updated_by_user_id)
			VALUES ($1, $2, $3::jsonb, $4, $5)
			ON CONFLICT (company_id) DO UPDATE SET time_zone = $2, away_hours = $3::jsonb, reply_grace_minutes = $4,
				updated_by_user_id = $5, updated_at = now()`
		if _, err := tx.Exec(ctx, upsert, company.String(), timeZone, string(stored), grace, actorUserID); err != nil {
			return err
		}
		return recordProgressWithin(ctx, tx, company, reached)
	})
}

// Answering is step 5: what ansa may say, and the holding reply.
type Answering struct {
	Instructions string `json:"instructions"`
	HoldingReply string `json:"holdingReply"`
}

// Check cleans the section and says what is wrong.
func (a *Answering) Check() Fields {
	fields := Fields{}
	var problem string
	if a.Instructions, problem = plaintext.Note(a.Instructions, 2000); problem != "" {
		fields["instructions"] = problem
	}
	a.HoldingReply, problem = plaintext.Note(a.HoldingReply, 500)
	if problem == "" && a.HoldingReply == "" {
		problem = "Write what people get while you take over."
	}
	if problem != "" {
		fields["holdingReply"] = problem
	}
	return fields
}

// SaveAnswering saves step 5.
func SaveAnswering(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, a Answering, reached int) (string, error) {
	return settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const upsert = `
			INSERT INTO assistant_settings (company_id, instructions, holding_reply, updated_by_user_id) VALUES ($1, $2, $3, $4)
			ON CONFLICT (company_id) DO UPDATE SET instructions = $2, holding_reply = $3, updated_by_user_id = $4, updated_at = now()`
		if _, err := tx.Exec(ctx, upsert, company.String(), a.Instructions, a.HoldingReply, actorUserID); err != nil {
			return err
		}
		return recordProgressWithin(ctx, tx, company, reached)
	})
}
