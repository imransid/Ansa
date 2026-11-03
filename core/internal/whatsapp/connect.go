package whatsapp

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgconn"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/settings"
	"ansa/core/internal/social"
	"ansa/core/internal/tenant"
)

// Connector connects and disconnects a company's WhatsApp number
// (Settings → Connections; owners connect and disconnect, members read).
type Connector struct {
	Pool *database.Pool
	Box  *secure.Box
	// ansa's Meta app, and its Embedded Signup configuration
	// (WHATSAPP_SIGNUP_CONFIG_ID).
	AppID, AppSecret, SignupConfigID string
	Development                      bool
}

// Mode: "real" with ansa's Meta app and its sign-up configuration,
// "stand-in" in development without them, "not-set-up" in production
// without them.
func (c *Connector) Mode() string {
	switch {
	case c.AppID != "" && c.AppSecret != "" && c.SignupConfigID != "":
		return "real"
	case c.Development:
		return "stand-in"
	}
	return "not-set-up"
}

// What connecting can come to, besides settings.Saved and settings.NotAllowed.
const (
	// The company has a number already: disconnect it first.
	AlreadyConnected = "exists"
	// The number is connected in another company.
	ConnectedElsewhere = "elsewhere"
)

// Connect completes Meta's sign-up for the company: an owner whose company
// has no number yet (checked before asking Meta, and again when saving),
// the number confirmed by Meta (Confirm: a *SignupError says why not), then
// saved with its token encrypted.
func (c *Connector) Connect(ctx context.Context, company tenant.CompanyID, actorUserID string, signup Signup) (string, error) {
	outcome, err := c.check(ctx, company, actorUserID)
	if err != nil || outcome != settings.Saved {
		return outcome, err
	}
	number, err := Confirm(ctx, c.AppID, c.AppSecret, signup)
	if err != nil {
		return "", err
	}
	return c.save(ctx, company, actorUserID, number, false)
}

// ConnectStandIn connects a development stand-in number (no Meta app: its
// customers come from the simulator, replies go to .dev-messages/). Its ids
// are the company's own, the same at every connect: each customer's contact
// id names the number, so a stand-in connected again keeps its
// conversations (as the stand-in Facebook Page's fixed id does).
func (c *Connector) ConnectStandIn(ctx context.Context, company tenant.CompanyID, actorUserID string) (string, error) {
	number := VerifiedNumber{WABAID: "stand-in:waba-" + company.String(), PhoneNumberID: "stand-in:" + company.String(), DisplayPhoneNumber: "+00 000 000 000", VerifiedName: "Stand-in WhatsApp number"}
	return c.save(ctx, company, actorUserID, number, true)
}

// check: an active owner, and no number connected in the company yet.
func (c *Connector) check(ctx context.Context, company tenant.CompanyID, actorUserID string) (string, error) {
	exists := false
	outcome, err := settings.AsOwner(ctx, c.Pool, company, actorUserID, func(tx database.Tx) error {
		live, err := hasLiveNumberWithin(ctx, tx, company)
		exists = live
		return err
	})
	if err == nil && outcome == settings.Saved && exists {
		return AlreadyConnected, nil
	}
	return outcome, err
}

// save writes the number in ONE transaction that takes the company row
// lock and reads the person's role again (settings.AsOwner); a number
// already connected in another company is refused by the database's own
// rule (one company at a time per number).
func (c *Connector) save(ctx context.Context, company tenant.CompanyID, actorUserID string, number VerifiedNumber, standIn bool) (string, error) {
	id, err := conversations.NewID()
	if err != nil {
		return "", err
	}
	var token *string
	if !standIn {
		encrypted, err := c.Box.Encrypt(number.Token, social.WhatsAppTokenContext(company, id))
		if err != nil {
			return "", err
		}
		token = &encrypted
	}
	var name *string
	if number.VerifiedName != "" {
		name = &number.VerifiedName
	}
	exists := false
	outcome, err := settings.AsOwner(ctx, c.Pool, company, actorUserID, func(tx database.Tx) error {
		live, err := hasLiveNumberWithin(ctx, tx, company)
		if err != nil || live {
			exists = live
			return err
		}
		const insert = `
			INSERT INTO whatsapp_numbers (id, company_id, waba_id, phone_number_id, display_phone_number, verified_name, shared_with_app, token_encrypted, is_stand_in, connected_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`
		_, err = tx.Exec(ctx, insert, id, company.String(), number.WABAID, number.PhoneNumberID, number.DisplayPhoneNumber, name, number.SharedWithApp, token, standIn, actorUserID)
		return err
	})
	var pgErr *pgconn.PgError
	switch {
	case errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "whatsapp_numbers_live_number_unique":
		return ConnectedElsewhere, nil
	case err == nil && outcome == settings.Saved && exists:
		return AlreadyConnected, nil
	}
	return outcome, err
}

// Disconnect stops the number's messages and replies in ansa, and deletes
// its token (the row stays, as history). Connecting again needs Meta's
// sign-up again.
func Disconnect(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string) (string, error) {
	return settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const update = `
			UPDATE whatsapp_numbers SET status = 'disconnected', token_encrypted = NULL, disconnected_at = now(), updated_at = now()
			WHERE company_id = $1 AND status <> 'disconnected'`
		_, err := tx.Exec(ctx, update, company.String())
		return err
	})
}

func hasLiveNumberWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID) (bool, error) {
	var live bool
	err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM whatsapp_numbers WHERE company_id = $1 AND status <> 'disconnected')`, company.String()).Scan(&live)
	return live, err
}
