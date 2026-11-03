package profile

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// CompanyNameTopic is the business name: the company's own name too (the
// sidebar, the sender of customer emails, Settings), so saving it renames
// the company, and it follows the company name's rules (the API checks
// them: 2-100 characters, one line).
const CompanyNameTopic = "company_name"

// renameCompanyWithin gives the company the business name just confirmed,
// in the transaction that confirmed it (as /setup's "Company name" confirms
// this fact): one name everywhere. The caller took the company row lock
// first, the order every owner setting takes.
func renameCompanyWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, name string) error {
	_, err := tx.Exec(ctx, `UPDATE companies SET name = $2 WHERE id = $1`, company.String(), name)
	return err
}

// SaveValue saves an owner's own value for one topic, confirmed at once
// (source "owner": Edit, or Fill in). originalValue is the confirmed value
// the editor opened with ("" = none): when the stored one differs, someone
// changed the fact meanwhile and nothing is saved (Stale). A proposal
// waiting beside it stays, unless it says the same as the new value: then
// there is nothing left to confirm, and it is cleared. A new business name
// renames the company too.
func SaveValue(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, topic, originalValue, value string) (string, error) {
	isName := topic == CompanyNameTopic
	return asOwner(ctx, pool, company, actorUserID, isName, func(tx database.Tx) (string, error) {
		var current *string
		err := tx.QueryRow(ctx, `SELECT confirmed_value FROM business_facts WHERE company_id = $1 AND topic = $2 FOR UPDATE`,
			company.String(), topic).Scan(&current)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
		stored := valueOf(current)
		if stored != originalValue {
			return Stale, nil
		}
		if stored == value {
			return Unchanged, nil
		}
		// WHERE: two first saves at the same moment both found no row to
		// lock; the later one must not overwrite the earlier one unseen.
		const upsert = `
			INSERT INTO business_facts (company_id, topic, confirmed_value, confirmed_source, confirmed_by_user_id, confirmed_at)
			VALUES ($1, $2, $3, 'owner', $4, now())
			ON CONFLICT (company_id, topic) DO UPDATE SET
				confirmed_value = $3, confirmed_source = 'owner', confirmed_by_user_id = $4, confirmed_at = now(),
				proposed_value = CASE WHEN business_facts.proposed_value = $3 THEN NULL ELSE business_facts.proposed_value END,
				proposed_source = CASE WHEN business_facts.proposed_value = $3 THEN NULL ELSE business_facts.proposed_source END,
				proposed_at = CASE WHEN business_facts.proposed_value = $3 THEN NULL ELSE business_facts.proposed_at END,
				updated_at = now()
			WHERE business_facts.confirmed_value IS NOT DISTINCT FROM $5`
		tag, err := tx.Exec(ctx, upsert, company.String(), topic, value, actorUserID, nullIfEmpty(originalValue))
		outcome, err := changedOrStale(tag.RowsAffected(), err)
		if err != nil || outcome != Changed || !isName {
			return outcome, err
		}
		return outcome, renameCompanyWithin(ctx, tx, company, value)
	})
}

// SaveProposalsWithin saves proposals of one company inside the caller's
// transaction, which has checked the person. A proposal goes BESIDE the
// confirmed value, never over it; one equal to the confirmed value or to
// the proposal already waiting writes nothing. Returns the topics that got
// a new proposal. Rows are written in the topic list's order, so two saves
// at the same moment (an interview turn and a suggestion) lock them in the
// same order and never wait for each other.
func SaveProposalsWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, proposals []Proposal, source string) ([]string, error) {
	// Every column named: the confirmed columns are never part of this write.
	const upsert = `
		INSERT INTO business_facts (company_id, topic, proposed_value, proposed_source, proposed_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (company_id, topic) DO UPDATE SET proposed_value = $3, proposed_source = $4, proposed_at = now(), updated_at = now()
		WHERE business_facts.confirmed_value IS DISTINCT FROM $3 AND business_facts.proposed_value IS DISTINCT FROM $3
		RETURNING topic`
	written := []string{}
	for _, topic := range Topics {
		for _, proposal := range proposals {
			if proposal.Topic != topic.Key {
				continue
			}
			var saved string
			err := tx.QueryRow(ctx, upsert, company.String(), proposal.Topic, proposal.Value, source).Scan(&saved)
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			if err != nil {
				return nil, err
			}
			written = append(written, saved)
		}
	}
	return written, nil
}

// SaveKnowledgeProposals saves the proposals the AI made from a knowledge
// article an owner picked, while that person is still an active owner.
func SaveKnowledgeProposals(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, proposals []Proposal) ([]string, string, error) {
	var topics []string
	outcome, err := asOwner(ctx, pool, company, actorUserID, false, func(tx database.Tx) (string, error) {
		written, err := SaveProposalsWithin(ctx, tx, company, CheckProposals(proposals), SourceKnowledge)
		topics = written
		return Changed, err
	})
	return topics, outcome, err
}
