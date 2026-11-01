package commands

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Phone lines: only ansa's operator links a Vapi number to a company (the
// numbers live in ansa's own Vapi account, and whoever holds a number's
// link receives its calls: transcripts and callers' numbers). The old
// db/phone-lines.ts.

var phoneNumberIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{3,100}$`)

// CleanPhoneNumberID is Vapi's id of a number as typed (trimmed), or "" when
// it isn't one: 3-100 letters, digits, "_" or "-".
func CleanPhoneNumberID(typed string) string {
	id := strings.TrimSpace(typed)
	if !phoneNumberIDPattern.MatchString(id) {
		return ""
	}
	return id
}

// Who a Vapi number is linked to, as link-phone-line reads it.
const (
	LineFree             = "free"
	LineOfThisCompany    = "this-company"
	LineOfAnotherCompany = "another-company"
)

// PhoneLineHolder says whether the number is linked already, to this company
// or to another: never which other company.
func PhoneLineHolder(ctx context.Context, pool *database.Pool, company tenant.CompanyID, numberID string) (string, error) {
	const statement = `
		-- cross-company: link-phone-line asks whether a Vapi number is linked already (it belongs to one company): this company or another, never which.
		SELECT company_id = $2::uuid FROM phone_lines WHERE vapi_phone_number_id = $1`
	var ours bool
	err := pool.QueryRow(ctx, statement, numberID, company.String()).Scan(&ours)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return LineFree, nil
	case err != nil:
		return "", err
	case ours:
		return LineOfThisCompany, nil
	}
	return LineOfAnotherCompany, nil
}

// LinkPhoneLine links the number to the company. False: it was linked
// meanwhile (a number is unique across companies), so nothing changed.
func LinkPhoneLine(ctx context.Context, pool *database.Pool, company tenant.CompanyID, numberID string) (bool, error) {
	const statement = `
		INSERT INTO phone_lines (company_id, vapi_phone_number_id) VALUES ($1, $2)
		ON CONFLICT (vapi_phone_number_id) DO NOTHING
		RETURNING id`
	var id string
	err := pool.QueryRow(ctx, statement, company.String(), numberID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// What unlinking did.
const (
	Unlinked     = "unlinked"
	NoSuchLine   = "no-such-line"
	LineHasCalls = "has-calls"
)

// UnlinkPhoneLine unlinks one of the company's numbers (another company's is
// "no such line" here). A number with calls stays: they point at it, and
// Postgres refuses the delete.
func UnlinkPhoneLine(ctx context.Context, pool *database.Pool, company tenant.CompanyID, numberID string) (string, error) {
	const statement = `DELETE FROM phone_lines WHERE company_id = $1 AND vapi_phone_number_id = $2 RETURNING id`
	var id string
	err := pool.QueryRow(ctx, statement, company.String(), numberID).Scan(&id)
	var pgErr *pgconn.PgError
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return NoSuchLine, nil
	case errors.As(err, &pgErr) && pgErr.Code == "23503":
		return LineHasCalls, nil
	case err != nil:
		return "", err
	}
	return Unlinked, nil
}

// IsCompanysPhoneLine: the Vapi number is one of the company's lines.
func IsCompanysPhoneLine(ctx context.Context, pool *database.Pool, company tenant.CompanyID, numberID string) (bool, error) {
	var linked bool
	err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM phone_lines WHERE company_id = $1 AND vapi_phone_number_id = $2)`, company.String(), numberID).Scan(&linked)
	return linked, err
}
