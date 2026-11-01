package accounts

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/teammates"
)

// Signup: 10 an hour per IP. Joining through invites: 60 an hour per IP (a
// whole team may join from one office on its first day) and 10 tries per
// invite link.
var (
	signupsPerIP       = ratelimit.Rule{MaxAttempts: 10, Window: time.Hour}
	inviteJoinsPerIP   = ratelimit.Rule{MaxAttempts: 60, Window: time.Hour}
	inviteJoinsPerLink = ratelimit.Rule{MaxAttempts: 10, Window: time.Hour}
)

// A new owner's company is named this until the setup's first step.
const newCompanyName = "New business"

// The answers of signup.
const (
	tooManySignups   = "Too many signup attempts. Try again in an hour."
	inviteNotUsable  = "This invite link has expired, was revoked, was already used, or is for a different email. Ask your team owner for a new one."
	tooManyLinkTries = "Too many tries with this invite link. Try again in an hour."
)

// NewPerson is what signup asks: a name, an address, a password (checked by the API).
type NewPerson struct {
	Name, Email, Password string
}

// SignUp makes a new company (named "New business" until the setup's first
// step: nothing in the request names or picks a company) with this person
// as its owner, and mails the confirmation link: no session until the
// address is confirmed. An address that already has an account changes
// nothing and gets the same answer (""); only the address is told, by email.
func (s *Service) SignUp(ctx context.Context, p NewPerson, r Request) (string, error) {
	if over, err := s.Limits.Over(ctx, "signup", r.IP, signupsPerIP); err != nil || over {
		return tooManySignups, err
	}
	return "", s.createAccount(ctx, p, "")
}

// JoinWithInvite makes the account of an invited person, in the inviting
// company with the invited role. The invite is checked BEFORE the address is
// looked up (a junk invite answers the same for any address, so the form
// tells nobody who has an account) and claimed for real, once, in the
// account's own transaction.
func (s *Service) JoinWithInvite(ctx context.Context, inviteToken string, p NewPerson, r Request) (string, error) {
	if over, err := s.Limits.Over(ctx, "invite-join", r.IP, inviteJoinsPerIP); err != nil || over {
		return tooManySignups, err
	}
	hash := teammates.HashInviteToken(inviteToken)
	if over, err := s.Limits.Over(ctx, "invite-join-link", hash, inviteJoinsPerLink); err != nil || over {
		return tooManyLinkTries, err
	}
	var usable bool
	const check = `
		-- cross-company: the invite's token (only its hash is stored) names its company; only that row is read.
		SELECT EXISTS (SELECT 1 FROM invites WHERE token_hash = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())`
	if err := s.Pool.QueryRow(ctx, check, hash, p.Email).Scan(&usable); err != nil {
		return "", err
	}
	if !usable {
		return inviteNotUsable, nil
	}
	err := s.createAccount(ctx, p, hash)
	if errors.Is(err, errInviteGone) {
		return inviteNotUsable, nil
	}
	return "", err
}

var errInviteGone = errors.New("accounts: the invite was used meanwhile")

// createAccount: an existing address only gets the "you already have an
// account" email. Otherwise ONE transaction: the company (new, or the
// invite's, the invite claimed), the person (unconfirmed), their password
// (Better Auth's credential row); then the confirmation link.
func (s *Service) createAccount(ctx context.Context, p NewPerson, inviteHash string) error {
	existing, err := s.existingUserID(ctx, p.Email)
	if err != nil {
		return err
	}
	if existing != "" {
		subject, text, htmlBody := existingAccountEmail(s.AppURL+"/login", s.AppURL+"/forgot-password")
		s.sendAccountEmail(ctx, "existing-account-email", p.Email, existing, subject, text, htmlBody)
		return nil
	}
	hash, err := HashPassword(p.Password)
	if err != nil {
		return err
	}
	userID, err := newID(32)
	if err != nil {
		return err
	}
	err = database.InTx(ctx, s.Pool, func(tx database.Tx) error {
		companyID, role, err := membershipWithin(ctx, tx, inviteHash, p.Email)
		if err != nil {
			return err
		}
		const user = `
			INSERT INTO users (id, company_id, role, name, email, email_verified, created_at, updated_at)
			VALUES ($1, $2, $3::user_role, $4, $5, false, now(), now())`
		if _, err := tx.Exec(ctx, user, userID, companyID, role, p.Name, p.Email); err != nil {
			return err
		}
		accountID, err := newID(32)
		if err != nil {
			return err
		}
		const password = `
			INSERT INTO accounts (id, account_id, provider_id, user_id, password, created_at, updated_at)
			VALUES ($1, $2, 'credential', $2, $3, now(), now())`
		_, err = tx.Exec(ctx, password, accountID, userID, hash)
		return err
	})
	if err != nil {
		return err
	}
	s.sendConfirmation(ctx, userID, p.Email)
	return nil
}

// membershipWithin decides which company a new person joins, in ONE place:
// with an invite, the inviting company and role (the invite claimed in one
// UPDATE: pending, for this address); without, a new company they own.
func membershipWithin(ctx context.Context, tx database.Tx, inviteHash, emailAddress string) (companyID, role string, err error) {
	if inviteHash == "" {
		err = tx.QueryRow(ctx, `INSERT INTO companies (name) VALUES ($1) RETURNING id`, newCompanyName).Scan(&companyID)
		return companyID, "owner", err
	}
	const claim = `
		-- cross-company: the invite's token (only its hash is stored) names its company; only that row changes.
		UPDATE invites SET accepted_at = now()
		WHERE token_hash = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
		RETURNING company_id, role`
	err = tx.QueryRow(ctx, claim, inviteHash, emailAddress).Scan(&companyID, &role)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", errInviteGone
	}
	return companyID, role, err
}

// existingUserID is the id of the account of an address ("" for none).
func (s *Service) existingUserID(ctx context.Context, emailAddress string) (string, error) {
	var id string
	err := s.Pool.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, emailAddress).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// Invite previews: 30 per 15 minutes per IP.
var invitePreviewsPerIP = ratelimit.Rule{MaxAttempts: 30, Window: 15 * time.Minute}

// InvitePreview is who an invite link is for, for the join page.
type InvitePreview struct {
	CompanyName string `json:"companyName"`
	Email       string `json:"email"`
	Role        string `json:"role"`
}

// PreviewInvite says who an invite link is for: nil for one that can't be
// used (unknown, used, revoked, expired); limited apart from "not usable",
// so a busy office isn't told a good invite is dead.
func (s *Service) PreviewInvite(ctx context.Context, inviteToken string, r Request) (*InvitePreview, bool, error) {
	if over, err := s.Limits.Over(ctx, "invite-preview", r.IP, invitePreviewsPerIP); err != nil || over {
		return nil, true, err
	}
	var preview InvitePreview
	const statement = `
		-- cross-company: the invite's token (only its hash is stored) names its company; only that row and its name are read.
		SELECT companies.name, invites.email, invites.role FROM invites JOIN companies ON companies.id = invites.company_id
		WHERE invites.token_hash = $1 AND invites.accepted_at IS NULL AND invites.revoked_at IS NULL AND invites.expires_at > now()`
	err := s.Pool.QueryRow(ctx, statement, teammates.HashInviteToken(inviteToken)).Scan(&preview.CompanyName, &preview.Email, &preview.Role)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	return &preview, false, err
}
