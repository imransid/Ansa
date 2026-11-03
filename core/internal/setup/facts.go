package setup

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// FactTopics are the business facts setup writes as the owner's own: the
// name, what the business does and its address. Saving them starts nothing
// of the marketing helper (Home's numbers, core/internal/home).
var FactTopics = []string{"company_name", "description", "location"}

// SetOwnerFactWithin sets one business fact as the owner's own (source
// "owner", confirmed at once) inside a transaction that already checked the
// owner: the setup's name, description and location, so posts can use them
// too (and /setup's "Company name", core/internal/supportsetup). A waiting
// proposal that says the same is cleared (nothing is left to confirm); any
// other stays for the owner to look at.
func SetOwnerFactWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, actorUserID, topic, value string) error {
	var confirmed, proposed *string
	err := tx.QueryRow(ctx, `SELECT confirmed_value, proposed_value FROM business_facts WHERE company_id = $1 AND topic = $2 FOR UPDATE`,
		company.String(), topic).Scan(&confirmed, &proposed)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if confirmed != nil && *confirmed == value {
		return nil
	}
	clearProposal := proposed != nil && *proposed == value
	const upsert = `
		INSERT INTO business_facts (company_id, topic, confirmed_value, confirmed_source, confirmed_by_user_id, confirmed_at)
		VALUES ($1, $2, $3, 'owner', $4, now())
		ON CONFLICT (company_id, topic) DO UPDATE SET confirmed_value = $3, confirmed_source = 'owner', confirmed_by_user_id = $4,
			confirmed_at = now(), updated_at = now(),
			proposed_value = CASE WHEN $5 THEN NULL ELSE business_facts.proposed_value END,
			proposed_source = CASE WHEN $5 THEN NULL ELSE business_facts.proposed_source END,
			proposed_at = CASE WHEN $5 THEN NULL ELSE business_facts.proposed_at END`
	_, err = tx.Exec(ctx, upsert, company.String(), topic, value, actorUserID, clearProposal)
	return err
}

// clearOwnerFactWithin clears one confirmed business fact (its four
// columns together, as a CHECK wants); a waiting proposal stays for the
// owner to look at.
func clearOwnerFactWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, topic string) error {
	const statement = `
		UPDATE business_facts SET confirmed_value = NULL, confirmed_source = NULL, confirmed_by_user_id = NULL, confirmed_at = NULL, updated_at = now()
		WHERE company_id = $1 AND topic = $2 AND confirmed_value IS NOT NULL`
	_, err := tx.Exec(ctx, statement, company.String(), topic)
	return err
}

// recordProgressWithin counts a setup step as saved: the progress is only
// ever raised (reached 0: a Settings save, not a setup step).
func recordProgressWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, reached int) error {
	if reached == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `UPDATE companies SET setup_progress = GREATEST(setup_progress, $2) WHERE id = $1`, company.String(), reached)
	return err
}
