// Package team answers questions about a company's people that writes
// depend on. More moves here with the team module (phase 6).
package team

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// RoleWithin reads a person's role inside the caller's transaction, their
// row locked FOR SHARE (a removal or a role change being saved at that
// moment is waited for, then seen): "owner" or "member" while they are
// confirmed and not removed, else "" (the old lockActiveAuthorRole).
func RoleWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, userID string) (string, error) {
	const statement = `
		SELECT role FROM users
		WHERE company_id = $1 AND id = $2 AND email_verified = true AND deactivated_at IS NULL
		FOR SHARE`
	var role string
	err := tx.QueryRow(ctx, statement, company.String(), userID).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return role, err
}

// LockCompanyWithin takes the company row lock that every numbering,
// routing and owner-setting transaction takes FIRST (the old
// lockCompanyRow): they run one at a time per company, always in the same
// order (the company, then the person), so they never deadlock.
func LockCompanyWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID) error {
	_, err := tx.Exec(ctx, `SELECT id FROM companies WHERE id = $1 FOR NO KEY UPDATE`, company.String())
	return err
}
