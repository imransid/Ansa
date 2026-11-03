package channels

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// WhatsApp is the company's WhatsApp number (step 56; nil: none, or
// disconnected). Connecting and disconnecting are core/internal/whatsapp's.
type WhatsApp struct {
	DisplayPhoneNumber string  `json:"displayPhoneNumber"`
	VerifiedName       *string `json:"verifiedName"`
	// connected, or removed_in_whatsapp (the business ended the link on Meta's side).
	Status string `json:"status"`
	// Also in use in the WhatsApp Business app (coexistence).
	SharedWithApp bool      `json:"sharedWithApp"`
	IsStandIn     bool      `json:"isStandIn"`
	ConnectedAt   time.Time `json:"connectedAt"`
}

func whatsappNumber(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (*WhatsApp, error) {
	const statement = `
		SELECT display_phone_number, verified_name, status, shared_with_app, is_stand_in, connected_at FROM whatsapp_numbers
		WHERE company_id = $1 AND status <> 'disconnected'`
	var w WhatsApp
	err := pool.QueryRow(ctx, statement, company.String()).Scan(&w.DisplayPhoneNumber, &w.VerifiedName, &w.Status, &w.SharedWithApp, &w.IsStandIn, &w.ConnectedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &w, nil
}
