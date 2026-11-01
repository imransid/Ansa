package profile

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// One company's interview messages (the old db/onboarding-messages.ts),
// encrypted with a context naming the company and the message. Every write
// takes the company row lock FIRST, then reads the person again: an
// answer, a reply and Start over then run one at a time per company. A
// lock on the answer's row alone would not do: Start over's DELETE would
// wait for it but not see a reply saved meanwhile, which would stay behind
// as a lone question.

// What saving an answer or a reply ended in, besides NotAllowed.
const (
	Saved = "saved"
	// The interview was started over meanwhile: nothing was saved.
	StartedOver = "started-over"
)

// MessageContext is the encryption context of one interview message (the
// old onboardingMessageContext, so both backends read each other's rows).
func MessageContext(company tenant.CompanyID, messageID string) string {
	return "onboarding-message:" + company.String() + ":" + messageID
}

// MessageRow is one stored message; the answering owner's name read within the company.
type MessageRow struct {
	ID            string
	Author        string
	AuthorName    *string
	BodyEncrypted string
	EndsInterview bool
	CreatedAt     time.Time
}

// NewMessage is a message to save: its id (the encryption context names
// it) and its encrypted text.
type NewMessage struct {
	ID            string
	BodyEncrypted string
}

// NewestMessages are one company's newest messages, newest first, at most limit.
func NewestMessages(ctx context.Context, q Querier, company tenant.CompanyID, limit int) ([]MessageRow, error) {
	const statement = `
		SELECT messages.id, messages.author, author.name, messages.body_encrypted, messages.ends_interview, messages.created_at
		FROM onboarding_messages AS messages
		LEFT JOIN users AS author ON author.company_id = messages.company_id AND author.id = messages.author_user_id
		WHERE messages.company_id = $1
		ORDER BY messages.created_at DESC, messages.id DESC
		LIMIT $2`
	rows, err := q.Query(ctx, statement, company.String(), limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (MessageRow, error) {
		var m MessageRow
		err := row.Scan(&m.ID, &m.Author, &m.AuthorName, &m.BodyEncrypted, &m.EndsInterview, &m.CreatedAt)
		return m, err
	})
}

// InterviewState: whether one company's interview started (its first
// question is saved with the first answer), and whether ansa's newest
// message closed it.
func InterviewState(ctx context.Context, q Querier, company tenant.CompanyID) (started, finished bool, err error) {
	const statement = `
		SELECT ends_interview FROM onboarding_messages
		WHERE company_id = $1 AND author = 'assistant'
		ORDER BY created_at DESC, id DESC LIMIT 1`
	rows, err := q.Query(ctx, statement, company.String())
	if err != nil {
		return false, false, err
	}
	ends, err := pgx.CollectRows(rows, pgx.RowTo[bool])
	if err != nil || len(ends) == 0 {
		return false, false, err
	}
	return true, ends[0], nil
}

const insertMessage = `
	INSERT INTO onboarding_messages (id, company_id, author, author_user_id, body_encrypted, ends_interview)
	VALUES ($1, $2, $3, $4, $5, $6)`

// SaveAnswer saves an owner's answer. An interview's first answer also
// saves, before it, the opening question the page showed (opening; nil
// when the page showed a conversation under way): if that conversation is
// gone (started over meanwhile), the answer has no question left and
// nothing is saved (StartedOver). The company row lock also keeps two
// first answers at the same moment from both saving an opening question.
func SaveAnswer(ctx context.Context, pool *database.Pool, company tenant.CompanyID, ownerUserID string, opening *NewMessage, answer NewMessage) (string, error) {
	return asOwner(ctx, pool, company, ownerUserID, true, func(tx database.Tx) (string, error) {
		var started bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM onboarding_messages WHERE company_id = $1)`, company.String()).Scan(&started); err != nil {
			return "", err
		}
		if !started && opening == nil {
			return StartedOver, nil
		}
		// Two statements, not one: each row's clock_timestamp() keeps their order.
		if !started {
			if _, err := tx.Exec(ctx, insertMessage, opening.ID, company.String(), "assistant", nil, opening.BodyEncrypted, false); err != nil {
				return "", err
			}
		}
		_, err := tx.Exec(ctx, insertMessage, answer.ID, company.String(), "owner", ownerUserID, answer.BodyEncrypted, false)
		return Saved, err
	})
}

// SaveReply saves ansa's reply to an answer and the proposals it brings,
// in ONE transaction: both or neither. Nothing is saved when the answer is
// gone (started over while the AI read it) or the person is no longer an
// active owner. Returns the topics that got a new proposal.
func SaveReply(ctx context.Context, pool *database.Pool, company tenant.CompanyID, ownerUserID, answerID string, reply NewMessage, endsInterview bool, proposals []Proposal) ([]string, string, error) {
	var topics []string
	outcome, err := asOwner(ctx, pool, company, ownerUserID, true, func(tx database.Tx) (string, error) {
		var answerKept bool
		const answerStill = `SELECT EXISTS (SELECT 1 FROM onboarding_messages WHERE company_id = $1 AND id = $2 AND author = 'owner')`
		if err := tx.QueryRow(ctx, answerStill, company.String(), answerID).Scan(&answerKept); err != nil || !answerKept {
			return StartedOver, err
		}
		written, err := SaveProposalsWithin(ctx, tx, company, proposals, SourceInterview)
		if err != nil {
			return "", err
		}
		topics = written
		_, err = tx.Exec(ctx, insertMessage, reply.ID, company.String(), "assistant", nil, reply.BodyEncrypted, endsInterview)
		return Saved, err
	})
	return topics, outcome, err
}

// DeleteMessages is "Start over": every message of one company's
// interview, never its facts. An answer or a reply being saved finishes
// first (the company row lock), and is deleted with the rest.
func DeleteMessages(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string) (string, error) {
	return asOwner(ctx, pool, company, actorUserID, true, func(tx database.Tx) (string, error) {
		_, err := tx.Exec(ctx, `DELETE FROM onboarding_messages WHERE company_id = $1`, company.String())
		return Changed, err
	})
}
