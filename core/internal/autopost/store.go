package autopost

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// What became of one planned post (autopost_slots.status, a CHECK repeats them).
const (
	SlotWriting         = "writing"
	SlotScheduled       = "scheduled"
	SlotWaitingApproval = "waiting_approval"
	SlotSkipped         = "skipped"
)

// Why a planned post was skipped, and the words the page shows.
var SkipReasonText = map[string]string{
	"no_page":       "No Facebook Page was connected.",
	"no_ai":         "No AI is set up (Settings → Assistant).",
	"ai_failed":     "The AI didn't answer in time.",
	"checks_failed": "ansa's checks stopped the text twice (a price, an offer or a link it couldn't confirm).",
	"not_owner":     "The owner who switched it on is no longer an owner: an owner switches it on again.",
	"stopped":       "Posting was switched off.",
}

// Company is one company with "Post for me" on.
type Company struct {
	ID                               tenant.CompanyID
	Frequency, Clock, Mode, TimeZone string
	// It posts in this owner's name, and stops once they are no longer an owner.
	EnabledByUserID string
}

// ListCompaniesPostingForThem are the companies with "Post for me" on: their
// ids and these settings, nothing else of their rows.
func ListCompaniesPostingForThem(ctx context.Context, pool *database.Pool) ([]Company, error) {
	const statement = `
		-- cross-company: "Post for me" runs serve every company that has it on; ids and these settings only.
		SELECT company_id, autopost_frequency, autopost_time, autopost_mode, time_zone, autopost_enabled_by_user_id
		FROM assistant_settings
		WHERE autopost_enabled AND time_zone IS NOT NULL AND autopost_enabled_by_user_id IS NOT NULL
		ORDER BY company_id`
	rows, err := pool.Query(ctx, statement)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var companies []Company
	for rows.Next() {
		var c Company
		var companyText string
		if err := rows.Scan(&companyText, &c.Frequency, &c.Clock, &c.Mode, &c.TimeZone, &c.EnabledByUserID); err != nil {
			return nil, err
		}
		if c.ID, err = tenant.FromTrustedSource(companyText); err != nil {
			return nil, err
		}
		companies = append(companies, c)
	}
	return companies, rows.Err()
}

// claimPostingTime claims one posting moment of one company: its row, or
// "" when another run has it already (the unique company + post_at).
func claimPostingTime(ctx context.Context, pool *database.Pool, company tenant.CompanyID, postAt time.Time, choice Choice) (string, error) {
	const insert = `
		INSERT INTO autopost_slots (company_id, post_at, kind, topic, item_name, special_day)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (company_id, post_at) DO NOTHING
		RETURNING id`
	var id string
	err := pool.QueryRow(ctx, insert, company.String(), postAt, choice.Kind, cut(choice.Topic, 200), cut(choice.ItemName, 200), choice.SpecialDay).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// finishPostingTime records what became of a claimed post: its draft and
// where it is, or why it was skipped.
func finishPostingTime(ctx context.Context, pool *database.Pool, company tenant.CompanyID, slotID, status, draftID, skipReason string, choice Choice, attempts int) error {
	if status == SlotSkipped {
		const skip = `UPDATE autopost_slots SET status = 'skipped', skip_reason = $3, attempts = $4, updated_at = now() WHERE company_id = $1 AND id = $2`
		_, err := pool.Exec(ctx, skip, company.String(), slotID, skipReason, attempts)
		return err
	}
	const written = `
		UPDATE autopost_slots SET status = $3, draft_id = $4, kind = $5, topic = $6, item_name = $7, special_day = $8, attempts = $9, updated_at = now()
		WHERE company_id = $1 AND id = $2`
	_, err := pool.Exec(ctx, written, company.String(), slotID, status, draftID, choice.Kind, cut(choice.Topic, 200), cut(choice.ItemName, 200), choice.SpecialDay, attempts)
	return err
}

// PostingTimeTaken: this posting time was claimed already (a cheap look
// before the writer reads everything it needs).
func PostingTimeTaken(ctx context.Context, pool *database.Pool, company tenant.CompanyID, postAt time.Time) (bool, error) {
	var taken bool
	err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM autopost_slots WHERE company_id = $1 AND post_at = $2)`, company.String(), postAt).Scan(&taken)
	return taken, err
}

// Slot is one planned post as the page and the topic brain read it.
type Slot struct {
	ID          string    `json:"id"`
	PostAt      time.Time `json:"postAt"`
	Status      string    `json:"status"`
	Kind        string    `json:"kind"`
	Topic       string    `json:"topic"`
	ItemName    string    `json:"itemName"`
	SpecialDay  string    `json:"specialDay"`
	SkipReason  *string   `json:"skipReason"`
	DraftID     *string   `json:"draftId"`
	DraftStatus *string   `json:"draftStatus"`
	Body        *string   `json:"body"`
	// Reactions + comments + shares in the post's newest numbers, or nil.
	Engagement *float64 `json:"engagement"`
}

// ListPostingTimes are the company's newest planned posts, newest first,
// each with its draft's status and text and its newest numbers.
func ListPostingTimes(ctx context.Context, pool *database.Pool, company tenant.CompanyID, limit int) ([]Slot, error) {
	const statement = `
		SELECT slots.id, slots.post_at, slots.status, slots.kind, slots.topic, slots.item_name, slots.special_day, slots.skip_reason,
			slots.draft_id, drafts.status, drafts.body,
			(SELECT COALESCE(metrics.reactions, 0) + COALESCE(metrics.comments, 0) + COALESCE(metrics.shares, 0)
				FROM post_metrics AS metrics
				JOIN publish_jobs AS jobs ON jobs.company_id = metrics.company_id AND jobs.id = metrics.publish_job_id
				WHERE jobs.company_id = slots.company_id AND jobs.draft_id = slots.draft_id
				ORDER BY metrics.collected_at DESC LIMIT 1)::float8
		FROM autopost_slots AS slots
		LEFT JOIN content_drafts AS drafts ON drafts.company_id = slots.company_id AND drafts.id = slots.draft_id
		WHERE slots.company_id = $1
		ORDER BY slots.post_at DESC LIMIT $2`
	rows, err := pool.Query(ctx, statement, company.String(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	slots := []Slot{}
	for rows.Next() {
		var s Slot
		if err := rows.Scan(&s.ID, &s.PostAt, &s.Status, &s.Kind, &s.Topic, &s.ItemName, &s.SpecialDay, &s.SkipReason, &s.DraftID, &s.DraftStatus, &s.Body, &s.Engagement); err != nil {
			return nil, err
		}
		slots = append(slots, s)
	}
	return slots, rows.Err()
}

// upcomingPostingTimes are planned posts still on their way.
func upcomingPostingTimes(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([][2]string, error) {
	const statement = `SELECT id, COALESCE(draft_id::text, '') FROM autopost_slots WHERE company_id = $1 AND status IN ('writing', 'scheduled', 'waiting_approval')`
	rows, err := pool.Query(ctx, statement, company.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var upcoming [][2]string
	for rows.Next() {
		var slotID, draftID string
		if err := rows.Scan(&slotID, &draftID); err != nil {
			return nil, err
		}
		upcoming = append(upcoming, [2]string{slotID, draftID})
	}
	return upcoming, rows.Err()
}

// cut keeps at most limit characters, never splitting one.
func cut(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit])
}
