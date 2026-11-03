package home

import (
	"context"
	"errors"
	"strconv"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Step is one thing an owner still has to do before ansa can answer.
type Step struct {
	Key      string `json:"key"`
	Done     bool   `json:"done"`
	Label    string `json:"label"`
	Href     string `json:"href"`
	DoneText string `json:"doneText"`
}

// BrainStatus is what the brain can answer with (its /v1/status).
type BrainStatus struct {
	AnsaKey    bool `json:"ansa_key"`
	ClaudeCode bool `json:"claude_code"`
}

// GettingStarted is the few things that make ansa answer at all, in the
// order to do them: owners only, and empty once all are done.
func GettingStarted(ctx context.Context, pool *database.Pool, company tenant.CompanyID, role string, brain BrainStatus) ([]Step, error) {
	if role != "owner" {
		return []Step{}, nil
	}
	var kind string
	if err := pool.QueryRow(ctx, `SELECT kind FROM companies WHERE id = $1`, company.String()).Scan(&kind); err != nil {
		return nil, err
	}
	channel, err := channelStep(ctx, pool, company)
	if err != nil {
		return nil, err
	}
	engine, ownKey, instructions := "api_key", false, ""
	err = pool.QueryRow(ctx, `SELECT ai_engine, anthropic_key_hint IS NOT NULL, instructions FROM assistant_settings WHERE company_id = $1`, company.String()).Scan(&engine, &ownKey, &instructions)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	aiReady := ownKey || brain.AnsaKey
	if engine == "claude_code" {
		aiReady = brain.ClaudeCode
	}
	steps := []Step{channel, {Key: "engine", Done: aiReady, Label: "Choose the AI that writes ansa's replies", Href: "/settings/assistant#engine-heading", DoneText: "The AI is ready."}}
	if kind == "business" {
		var items int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM catalog_items WHERE company_id = $1`, company.String()).Scan(&items); err != nil {
			return nil, err
		}
		steps = append(steps, Step{Key: "menu", Done: items > 0, Label: "Add what you sell and its prices", Href: "/settings/menu", DoneText: strconv.Itoa(items) + " on your menu."})
	} else {
		steps = append(steps, Step{Key: "instructions", Done: instructions != "", Label: "Tell ansa what it may say for you", Href: "/settings/assistant#instructions", DoneText: "ansa knows what it may say."})
	}
	for _, step := range steps {
		if !step.Done {
			return steps, nil
		}
	}
	return []Step{}, nil
}

// HasTeam: more than one person takes requests (confirmed, not removed), so
// "nobody on it" says something the conversations listed don't.
func HasTeam(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (bool, error) {
	var people int
	err := pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE company_id = $1 AND email_verified = true AND deactivated_at IS NULL`, company.String()).Scan(&people)
	return people > 1, err
}

// channelStep: a chat where people write to you, WhatsApp (step 56) or
// Telegram, connected and allowed to reply.
func channelStep(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (Step, error) {
	var telegramStatus string
	var telegramStandIn bool
	err := pool.QueryRow(ctx, `SELECT status, is_stand_in FROM channel_connections WHERE company_id = $1 AND channel = 'telegram' AND status <> 'disconnected'`, company.String()).Scan(&telegramStatus, &telegramStandIn)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Step{}, err
	}
	var whatsappStatus string
	var whatsappStandIn bool
	err = pool.QueryRow(ctx, `SELECT status, is_stand_in FROM whatsapp_numbers WHERE company_id = $1 AND status <> 'disconnected'`, company.String()).Scan(&whatsappStatus, &whatsappStandIn)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Step{}, err
	}
	step := Step{Key: "channel", Label: "Connect WhatsApp or Telegram, where people write to you", Href: "/settings/channels"}
	switch {
	case whatsappStatus == "connected":
		step.Done, step.DoneText = true, "WhatsApp is connected."
		if whatsappStandIn {
			step.DoneText = "A stand-in WhatsApp number is connected (development)."
		}
	case telegramStatus == "connected":
		step.Done, step.DoneText = true, "Telegram is connected."
		if telegramStandIn {
			step.DoneText = "A stand-in Telegram account is connected (development)."
		}
	case telegramStatus != "":
		step.Label = "Let ansa reply on Telegram"
	}
	return step, nil
}
