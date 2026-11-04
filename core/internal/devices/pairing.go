package devices

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// What pairing ends in.
const (
	Paired        = "paired"
	WrongCode     = "wrong-code"
	TooManyPhones = "too-many-phones"
)

// NewPhone is what the app says about itself when it pairs.
type NewPhone struct {
	Name     string
	Platform string
}

// Pairing is a pairing's outcome; the token only when it paired (the one
// time the app gets it).
type Pairing struct {
	Outcome string
	Token   string
	Device  Device
}

// CleanName is the phone's name as one plain line of 1 to 60 characters
// (a longer one is cut): "" when nothing is left of it.
func CleanName(name string) string {
	clean := plaintext.SingleLine(name)
	if utf8.RuneCountInString(clean) > maxNameLength {
		clean = strings.TrimSpace(string([]rune(clean)[:maxNameLength]))
	}
	return clean
}

// PlatformKnown: the app runs on iPhones and Android phones.
func PlatformKnown(platform string) bool {
	return platform == "ios" || platform == "android"
}

// errRefused rolls a pairing back: the code stays unused (it may still work
// once its owner removed a phone, say), and nothing is written.
var errRefused = errors.New("pairing refused")

// Pair connects a phone with a code (normalized, NormalizeCode) and a clean
// name and platform, in ONE transaction: the code CLAIMED in one UPDATE
// (unused, unexpired: two phones with one code = one phone), the company
// row lock, the code's maker read again (still a confirmed, active owner:
// someone removed or made a member since is refused), the company's
// connected phones counted, then the phone saved with its token's hash.
func Pair(ctx context.Context, pool *database.Pool, code string, phone NewPhone) (Pairing, error) {
	result := Pairing{Outcome: WrongCode}
	token, err := newDeviceToken()
	if err != nil {
		return result, err
	}
	err = database.InTx(ctx, pool, func(tx database.Tx) error {
		company, maker, found, err := claimCodeWithin(ctx, tx, hashSecret(code))
		if err != nil || !found {
			return err
		}
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		role, err := team.RoleWithin(ctx, tx, company, maker)
		if err != nil {
			return err
		}
		if role != "owner" {
			return errRefused
		}
		var connected int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM devices WHERE company_id = $1 AND removed_at IS NULL`, company.String()).Scan(&connected); err != nil {
			return err
		}
		if connected >= MaxDevicesPerCompany {
			result.Outcome = TooManyPhones
			return errRefused
		}
		const insert = `
			INSERT INTO devices (company_id, paired_by_user_id, name, platform, token_hash)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id`
		if err := tx.QueryRow(ctx, insert, company.String(), maker, phone.Name, phone.Platform, hashSecret(token)).Scan(&result.Device.ID); err != nil {
			return err
		}
		result.Outcome, result.Token = Paired, token
		result.Device.Company, result.Device.PairedByUserID = company, maker
		return nil
	})
	if errors.Is(err, errRefused) {
		return Pairing{Outcome: result.Outcome}, nil
	}
	if err != nil {
		return Pairing{Outcome: WrongCode}, err
	}
	return result, nil
}

// claimCodeWithin marks the code with this hash used, if unused and
// unexpired, in the one UPDATE that finds it, and returns its company and
// maker.
func claimCodeWithin(ctx context.Context, tx database.Tx, codeHash string) (tenant.CompanyID, string, bool, error) {
	const statement = `
		-- cross-company: the code's hash names its company (ansa made it, and stores only the hash); only that row is read and changed.
		UPDATE device_pair_codes SET used_at = now()
		WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()
		RETURNING company_id, created_by_user_id`
	var companyID, maker string
	err := tx.QueryRow(ctx, statement, codeHash).Scan(&companyID, &maker)
	if errors.Is(err, pgx.ErrNoRows) {
		return tenant.CompanyID{}, "", false, nil
	}
	if err != nil {
		return tenant.CompanyID{}, "", false, err
	}
	company, err := tenant.FromTrustedSource(companyID)
	return company, maker, err == nil, err
}
