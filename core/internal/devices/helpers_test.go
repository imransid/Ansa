package devices

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/settings"
	"ansa/core/internal/tenant"
)

// account is one test company with a confirmed owner.
type account struct {
	t       *testing.T
	pool    *database.Pool
	company tenant.CompanyID
	owner   string
}

func newAccount(t *testing.T, pool *database.Pool) *account {
	t.Helper()
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	return &account{t: t, pool: pool, company: company, owner: database.TestOwner(t, pool, companyID)}
}

// code makes a pair code as an owner on the website does.
func (a *account) code() string {
	a.t.Helper()
	made, outcome, err := MakePairCode(context.Background(), a.pool, a.company, a.owner, "http://127.0.0.1:8080")
	if err != nil || outcome != settings.Saved {
		a.t.Fatalf("making a pair code: %q %v", outcome, err)
	}
	return made.Code
}

// phone pairs a phone and returns its token and the phone.
func (a *account) phone(name string) (string, Device) {
	a.t.Helper()
	pairing, err := Pair(context.Background(), a.pool, a.code(), NewPhone{Name: name, Platform: "ios"})
	if err != nil || pairing.Outcome != Paired {
		a.t.Fatalf("pairing: %q %v", pairing.Outcome, err)
	}
	return pairing.Token, pairing.Device
}

// follow switches "Answer for me when my phone is unreachable" on.
func (a *account) follow(minutes int) {
	a.t.Helper()
	if outcome, err := SaveSettings(context.Background(), a.pool, a.company, a.owner, true, minutes); err != nil || outcome != settings.Saved {
		a.t.Fatalf("following the phone: %q %v", outcome, err)
	}
}

// phoneSilentFor makes it as if the phone last checked in `ago`: its
// check-in (and its pairing before it) and the last switch of away move
// that far back, as if the time had passed.
func (a *account) phoneSilentFor(device Device, ago string) {
	a.exec(`UPDATE devices SET last_seen_at = now() - $3::interval, paired_at = now() - $3::interval - interval '1 hour' WHERE company_id = $1 AND id = $2`,
		a.company.String(), device.ID, ago)
	a.exec(`UPDATE assistant_settings SET away_changed_at = away_changed_at - $2::interval - interval '1 second' WHERE company_id = $1 AND away_changed_at IS NOT NULL`,
		a.company.String(), ago)
}

// awayState is away_since set or not, and who set it (no settings: not away).
func (a *account) awayState() (bool, string) {
	a.t.Helper()
	var away bool
	var setBy string
	err := a.pool.QueryRow(context.Background(), `SELECT away_since IS NOT NULL, COALESCE(away_set_by, '') FROM assistant_settings WHERE company_id = $1`,
		a.company.String()).Scan(&away, &setBy)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		a.t.Fatalf("reading away: %v", err)
	}
	return away, setBy
}

// conversation is a stand-in customer's conversation, with their first message.
func (a *account) conversation(externalID string) string {
	a.t.Helper()
	id, _ := conversations.NewID()
	turn, err := conversations.InsertCustomerMessage(context.Background(), a.pool, a.company,
		conversations.ContactKey{Channel: conversations.ChannelStandIn, ExternalID: externalID},
		conversations.IncomingMessage{ID: id, BodyEncrypted: "v1:x:y:z", ChannelMessageID: id})
	if err != nil || turn == nil {
		a.t.Fatalf("saving the customer's message: %v", err)
	}
	return turn.ConversationID
}

func (a *account) exec(statement string, args ...any) {
	a.t.Helper()
	if _, err := a.pool.Exec(context.Background(), statement, args...); err != nil {
		a.t.Fatalf("%s: %v", statement, err)
	}
}

func (a *account) count(statement string, args ...any) int {
	a.t.Helper()
	var n int
	if err := a.pool.QueryRow(context.Background(), statement, args...).Scan(&n); err != nil {
		a.t.Fatalf("count: %v", err)
	}
	return n
}
