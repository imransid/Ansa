package devices

import (
	"context"
	"errors"
	"regexp"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// A device token: 32 bytes as unpadded base64url.
var tokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

// Authenticate finds the connected phone a token belongs to, by its
// SHA-256 (so no comparison of the token itself can leak its letters
// through timing), then reads its owner within its own company: nil when
// the token is unknown, the phone was removed, or the owner who paired it
// is no longer a confirmed, active owner (removed, or made a member).
func Authenticate(ctx context.Context, pool *database.Pool, token string) (*Device, error) {
	if !tokenPattern.MatchString(token) {
		return nil, nil
	}
	const find = `
		-- cross-company: a device token's hash names one phone of one company (only ansa issues tokens, and stores only their hash); its ids only.
		SELECT id, company_id, paired_by_user_id FROM devices WHERE token_hash = $1 AND removed_at IS NULL`
	var companyID string
	device := &Device{}
	err := pool.QueryRow(ctx, find, hashSecret(token)).Scan(&device.ID, &companyID, &device.PairedByUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if device.Company, err = tenant.FromTrustedSource(companyID); err != nil {
		return nil, err
	}
	owner, err := isActiveOwner(ctx, pool, device.Company, device.PairedByUserID)
	if err != nil || !owner {
		return nil, err
	}
	return device, nil
}

// isActiveOwner: confirmed, not removed, and still an owner.
func isActiveOwner(ctx context.Context, pool *database.Pool, company tenant.CompanyID, userID string) (bool, error) {
	const statement = `
		SELECT EXISTS (SELECT 1 FROM users WHERE company_id = $1 AND id = $2 AND role = 'owner' AND email_verified = true AND deactivated_at IS NULL)`
	var owner bool
	err := pool.QueryRow(ctx, statement, company.String(), userID).Scan(&owner)
	return owner, err
}
