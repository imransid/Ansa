// Package commands is what ansa's command-line tools share (the old
// scripts/company-of-user.ts and the statements the old scripts ran):
// core/cmd/operator (ansa's operator, also against production) and
// core/cmd/simulate (development only). A command run by hand has no
// session, so a company is found ONLY by the address of a confirmed, active
// owner, never by an id typed in; a command that changes something prints
// the company first and changes nothing without --yes; the development
// tools refuse production and any database not on this computer.
//
// OUTPUT RULE: a command names the company and what changed. Never a token,
// a secret, a customer's address or a message.
package commands

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// ConfirmFlag lets a command change something. Without it, a command only
// shows which company it would change.
const ConfirmFlag = "--yes"

// Company is the company a command found, and the owner whose address found it.
type Company struct {
	ID   tenant.CompanyID
	Name string
	// The owner's id (seed-tickets records them as the samples' creator).
	OwnerID string
}

// Refusal is a message for the person at the command line, written as
// sentences: printed as it is, and the command exits with 1.
type Refusal string

func (r Refusal) Error() string { return string(r) }

// ErrNoOwner: the address isn't a confirmed, active owner's.
var ErrNoOwner = Refusal("That address is not the confirmed address of an owner (not removed) of any company. Nothing was changed.")

// FindOwnersCompany is the company of the OWNER with this address. Any
// other account with the address may sit in the wrong company: an invite
// an owner sent to someone else's address (or a typo) makes an account in
// the inviter's company, and whoever's company holds a phone line receives
// its calls. Returns ErrNoOwner when no confirmed, active owner has it.
func FindOwnersCompany(ctx context.Context, pool *database.Pool, email string) (Company, error) {
	const statement = `
		-- cross-company: a command run by hand finds a company only by a confirmed, active owner's address (an address is one account); its id, name and that owner's id.
		SELECT companies.id, companies.name, users.id FROM users
		JOIN companies ON companies.id = users.company_id
		WHERE users.email = $1 AND users.role = 'owner' AND users.email_verified = true AND users.deactivated_at IS NULL`
	var id string
	var found Company
	err := pool.QueryRow(ctx, statement, strings.ToLower(strings.TrimSpace(email))).Scan(&id, &found.Name, &found.OwnerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Company{}, ErrNoOwner
	}
	if err != nil {
		return Company{}, err
	}
	found.ID, err = tenant.FromTrustedSource(id)
	return found, err
}

// Describe is the one line a command prints about the company it found,
// before it acts. The id tells apart two companies of the same name (every
// new one is "New business" until its setup's first step).
func Describe(company Company) string {
	return fmt.Sprintf("Company: %q (company id %s)", company.Name, company.ID)
}

// AskToConfirm is what a command says instead of changing anything without
// --yes (exit code 1: a script calling it doesn't carry on as if it had).
func AskToConfirm(action string) error {
	return Refusal("Nothing was changed. If this is the right company, run the same command again with " + ConfirmFlag + " to " + action + ".")
}

// SplitConfirm takes --yes out of a command's arguments, wherever it is.
func SplitConfirm(args []string) (values []string, confirmed bool) {
	for _, arg := range args {
		if arg == ConfirmFlag {
			confirmed = true
			continue
		}
		values = append(values, arg)
	}
	return values, confirmed
}
