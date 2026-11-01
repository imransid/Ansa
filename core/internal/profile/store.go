package profile

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// What a change of a fact ended in. "stale": the stored value is no longer
// the one the page showed (someone changed it, or a newer proposal came,
// meanwhile): nothing was written.
const (
	Changed    = "changed"
	Unchanged  = "unchanged"
	Stale      = "stale"
	NotAllowed = "not-allowed"
)

// Querier is a pool or a transaction.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Row is one topic's stored row, the confirmer's name read within the company.
type Row struct {
	Topic           string
	ConfirmedValue  *string
	ConfirmedSource *string
	ConfirmedAt     *time.Time
	ConfirmedByName *string
	ProposedValue   *string
	ProposedSource  *string
	ProposedAt      *time.Time
}

// ReadRows are every row of one company's profile (a topic without one is missing).
func ReadRows(ctx context.Context, q Querier, company tenant.CompanyID) ([]Row, error) {
	const statement = `
		SELECT facts.topic, facts.confirmed_value, facts.confirmed_source, facts.confirmed_at, confirmer.name,
			facts.proposed_value, facts.proposed_source, facts.proposed_at
		FROM business_facts AS facts
		LEFT JOIN users AS confirmer ON confirmer.company_id = facts.company_id AND confirmer.id = facts.confirmed_by_user_id
		WHERE facts.company_id = $1`
	rows, err := q.Query(ctx, statement, company.String())
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Row, error) {
		var r Row
		err := row.Scan(&r.Topic, &r.ConfirmedValue, &r.ConfirmedSource, &r.ConfirmedAt, &r.ConfirmedByName, &r.ProposedValue, &r.ProposedSource, &r.ProposedAt)
		return r, err
	})
}

// ReadFacts are one company's values by topic (a topic the code no longer lists is left out).
func ReadFacts(ctx context.Context, q Querier, company tenant.CompanyID) (Facts, error) {
	rows, err := ReadRows(ctx, q, company)
	if err != nil {
		return nil, err
	}
	return factsOf(rows), nil
}

func factsOf(rows []Row) Facts {
	facts := Facts{}
	for _, row := range rows {
		if _, known := FindTopic(row.Topic); known {
			facts[row.Topic] = Values{Confirmed: valueOf(row.ConfirmedValue), Proposed: valueOf(row.ProposedValue)}
		}
	}
	return facts
}

func valueOf(text *string) string {
	if text == nil {
		return ""
	}
	return *text
}

// asOwner runs write in one transaction while the person is an active
// owner of the company, their row read again FOR SHARE (an owner made a
// member at this moment is refused). Returns NotAllowed otherwise.
func asOwner(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, lockCompanyFirst bool, write func(tx database.Tx) (string, error)) (string, error) {
	outcome := NotAllowed
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if lockCompanyFirst {
			if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
				return err
			}
		}
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role != "owner" {
			return err
		}
		outcome, err = write(tx)
		return err
	})
	return outcome, err
}

// Confirm makes a waiting proposal the fact: as the page showed it, or as
// the owner edited it (value differs: the source is "owner"). The UPDATE
// requires the proposal AND the confirmed value beside it ("" = none) to
// still be exactly the ones shown, so nobody confirms words they didn't
// see or replaces a value they never saw. The proposal is cleared.
func Confirm(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, topic, shownProposal, shownConfirmed, value string) (string, error) {
	return asOwner(ctx, pool, company, actorUserID, false, func(tx database.Tx) (string, error) {
		// SET reads the row as it was, so proposed_source is the proposal's own.
		const statement = `
			UPDATE business_facts SET confirmed_value = $4,
				confirmed_source = CASE WHEN $4 = $3 THEN proposed_source ELSE 'owner' END,
				confirmed_by_user_id = $5, confirmed_at = now(),
				proposed_value = NULL, proposed_source = NULL, proposed_at = NULL, updated_at = now()
			WHERE company_id = $1 AND topic = $2 AND proposed_value = $3 AND confirmed_value IS NOT DISTINCT FROM $6`
		tag, err := tx.Exec(ctx, statement, company.String(), topic, shownProposal, value, actorUserID, nullIfEmpty(shownConfirmed))
		return changedOrStale(tag.RowsAffected(), err)
	})
}

// Dismiss clears a waiting proposal while it is still the one the page
// showed (a newer one stays). The confirmed value stays.
func Dismiss(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, topic, shownProposal string) (string, error) {
	return asOwner(ctx, pool, company, actorUserID, false, func(tx database.Tx) (string, error) {
		const statement = `
			UPDATE business_facts SET proposed_value = NULL, proposed_source = NULL, proposed_at = NULL, updated_at = now()
			WHERE company_id = $1 AND topic = $2 AND proposed_value = $3`
		tag, err := tx.Exec(ctx, statement, company.String(), topic, shownProposal)
		return changedOrStale(tag.RowsAffected(), err)
	})
}

func changedOrStale(rows int64, err error) (string, error) {
	if err != nil {
		return "", err
	}
	if rows == 0 {
		return Stale, nil
	}
	return Changed, nil
}

func nullIfEmpty(text string) *string {
	if text == "" {
		return nil
	}
	return &text
}
