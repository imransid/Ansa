package setup

import (
	"context"
	"errors"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/settings"
	"ansa/core/internal/tenant"
)

// Business is step 1: who ansa is for, the name, a business's kind and what
// it offers (a person: what they do, if they like).
type Business struct {
	Kind         string  `json:"kind"`
	CompanyName  string  `json:"companyName"`
	BusinessType *string `json:"businessType"`
	Description  string  `json:"description"`
}

// Check cleans the section and says what is wrong (the old businessSectionSchema).
func (b *Business) Check() Fields {
	fields := Fields{}
	if b.Kind != "business" && b.Kind != "personal" {
		fields["kind"] = "Choose who ansa is for."
	}
	b.CompanyName = strings.TrimSpace(b.CompanyName)
	switch length := utf8.RuneCountInString(b.CompanyName); {
	case length < 2:
		fields["companyName"] = "Company name must be at least 2 characters"
	case length > 100:
		fields["companyName"] = "Company name must be at most 100 characters"
	case strings.IndexFunc(b.CompanyName, unicode.IsControl) >= 0:
		fields["companyName"] = "Company name can't contain line breaks or other control characters"
	}
	b.Description = plaintext.SingleLine(b.Description)
	if utf8.RuneCountInString(b.Description) > 300 {
		fields["description"] = "At most 300 characters."
	}
	if b.Kind == "personal" {
		b.BusinessType = nil
		return fields
	}
	if b.BusinessType == nil || !slices.Contains(businessTypes, *b.BusinessType) {
		fields["businessType"] = "Choose what kind of business it is."
	}
	if b.Description == "" && fields["description"] == "" {
		fields["description"] = "Say in a sentence what you offer."
	}
	return fields
}

// SaveBusiness saves step 1. Changing who ansa is for starts the later
// steps again (their list differs), switches when ansa answers (a person's:
// only while away) and the holding reply while it is still one of ansa's own.
func SaveBusiness(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, b Business, reached int) (string, error) {
	return settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		var kindBefore, nameBefore string
		if err := tx.QueryRow(ctx, `SELECT kind, name FROM companies WHERE id = $1`, company.String()).Scan(&kindBefore, &nameBefore); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE companies SET name = $2, kind = $3, business_type = $4 WHERE id = $1`, company.String(), b.CompanyName, b.Kind, b.BusinessType); err != nil {
			return err
		}
		if err := SetOwnerFactWithin(ctx, tx, company, actorUserID, "company_name", b.CompanyName); err != nil {
			return err
		}
		if err := saveDescriptionWithin(ctx, tx, company, actorUserID, b); err != nil {
			return err
		}
		if err := followKindWithin(ctx, tx, company, actorUserID, kindBefore, nameBefore, b); err != nil {
			return err
		}
		if kindBefore != b.Kind && reached != 0 {
			_, err := tx.Exec(ctx, `UPDATE companies SET setup_progress = $2 WHERE id = $1`, company.String(), reached)
			return err
		}
		return recordProgressWithin(ctx, tx, company, reached)
	})
}

// saveDescriptionWithin saves what a business offers or what a person
// does. A person may leave it empty: that clears what was saved, so the AI
// no longer reads it (a business always has one: Check).
func saveDescriptionWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, actorUserID string, b Business) error {
	if b.Description != "" {
		return SetOwnerFactWithin(ctx, tx, company, actorUserID, "description", b.Description)
	}
	if b.Kind != "personal" {
		return nil
	}
	return clearOwnerFactWithin(ctx, tx, company, "description")
}

// followKindWithin sets the assistant's defaults that depend on who it is for.
func followKindWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, actorUserID, kindBefore, nameBefore string, b Business) error {
	current := settings.DefaultHoldingReply
	err := tx.QueryRow(ctx, `SELECT holding_reply FROM assistant_settings WHERE company_id = $1`, company.String()).Scan(&current)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	holding := current
	if current == settings.DefaultHoldingReply || current == PersonalHoldingReply(nameBefore) {
		holding = settings.DefaultHoldingReply
		if b.Kind == "personal" {
			holding = PersonalHoldingReply(b.CompanyName)
		}
	}
	answerWhen := "always"
	if b.Kind == "personal" {
		answerWhen = "when_away"
	}
	const upsert = `
		INSERT INTO assistant_settings (company_id, holding_reply, answer_when, updated_by_user_id) VALUES ($1, $2, $3, $4)
		ON CONFLICT (company_id) DO UPDATE SET holding_reply = $2, updated_by_user_id = $4, updated_at = now(),
			answer_when = CASE WHEN $5 THEN $3 ELSE assistant_settings.answer_when END`
	_, err = tx.Exec(ctx, upsert, company.String(), holding, answerWhen, actorUserID, kindBefore != b.Kind)
	return err
}
