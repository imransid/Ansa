package conversations

import (
	"context"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// ownAnswerWorld is a company with its owner (who connected the business's
// account), a customer's message, ansa waiting to step in, and a reply of
// ansa's waiting for approval ("Ask me first").
type ownAnswerWorld struct {
	pool                *database.Pool
	company             tenant.CompanyID
	owner, conversation string
	contact             ContactKey
	draftID             string
	ctx                 context.Context
}

func newOwnAnswerWorld(t *testing.T) *ownAnswerWorld {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	w := &ownAnswerWorld{pool: pool, owner: database.TestOwner(t, pool, companyID), contact: ContactKey{Channel: ChannelWhatsApp, ExternalID: "stand-in:" + companyID + ":XX.sam"}, ctx: context.Background()}
	w.company, _ = tenant.FromTrustedSource(companyID)
	turn, err := InsertCustomerMessage(w.ctx, pool, w.company, w.contact, IncomingMessage{ID: newID(t), BodyEncrypted: "v1:x:y:z", ChannelMessageID: "c-1"})
	if err != nil {
		t.Fatal(err)
	}
	w.conversation = turn.ConversationID
	w.draftID = newID(t)
	w.exec(t, `UPDATE conversations SET assistant_due_at = now() + interval '5 minutes' WHERE company_id = $1 AND id = $2`, companyID, w.conversation)
	w.exec(t, `INSERT INTO messages (id, company_id, conversation_id, direction, author, body_encrypted, send_status) VALUES ($1, $2, $3, 'out', 'assistant', 'v1:x:y:z', 'draft')`,
		w.draftID, companyID, w.conversation)
	return w
}

func (w *ownAnswerWorld) exec(t *testing.T, statement string, args ...any) {
	if _, err := w.pool.Exec(w.ctx, statement, args...); err != nil {
		t.Fatalf("setup: %v", err)
	}
}

func (w *ownAnswerWorld) answerInTheApp(t *testing.T, channelMessageID string) {
	saved, err := InsertBusinessAccountMessage(w.ctx, w.pool, w.company, w.contact, IncomingMessage{ID: newID(t), BodyEncrypted: "v1:x:y:z", ChannelMessageID: channelMessageID}, w.owner)
	if err != nil || !saved {
		t.Fatalf("saved=%v err=%v", saved, err)
	}
}

func (w *ownAnswerWorld) count(t *testing.T, statement string) int {
	var n int
	if err := w.pool.QueryRow(w.ctx, statement, w.company.String(), w.conversation).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

// The owner's direction: answering yourself means you're handling it. Where
// ansa answers every message ("Always"), the business's own answer in its
// app takes the conversation over as a person's reply in ansa does (in the
// name of whoever connected the account: the database records a person),
// written by ansa's app (no teammate named), and ansa's waiting reply is
// discarded; a second answer changes nothing more.
func TestTheBusinessAnsweringInItsAppTakesTheConversationOverWhereAnsaAnswersAlways(t *testing.T) {
	w := newOwnAnswerWorld(t)
	w.answerInTheApp(t, "b-1")
	taken := `SELECT count(*) FROM conversations WHERE company_id = $1 AND id = $2 AND handled_by = 'person' AND taken_over_by_user_id = '` + w.owner + `'
		AND taken_over_at IS NOT NULL AND assistant_due_at IS NULL`
	if w.count(t, taken) != 1 {
		t.Fatal("taken over in the name of the account's holder, and ansa no longer waits to step in")
	}
	if w.count(t, `SELECT count(*) FROM messages WHERE company_id = $1 AND conversation_id = $2 AND id = '`+w.draftID+`' AND send_status = 'discarded'`) != 1 {
		t.Fatal("ansa's waiting reply answered a message the business answered: it never goes")
	}
	lines := `SELECT count(*) FROM assistant_activity WHERE company_id = $1 AND conversation_id = $2 AND actor_user_id IS NULL AND action = `
	if w.count(t, lines+`'taken_over'`) != 1 || w.count(t, lines+`'draft_discarded'`) != 1 {
		t.Fatal("one taken-over line and one discard line, written by the app (no teammate did it in ansa)")
	}
	w.answerInTheApp(t, "b-2")
	if w.count(t, lines+`'taken_over'`) != 1 || w.count(t, lines+`'draft_discarded'`) != 1 {
		t.Fatal("answering again in a conversation already taken over writes no new line")
	}
}

// With "Only when I'm away" the business's own answer only ends ansa's wait
// for that message (and discards ansa's waiting reply): ansa answers the
// next ones as that setting says.
func TestWhenAwayTheBusinessAnsweringInItsAppOnlyEndsTheWait(t *testing.T) {
	w := newOwnAnswerWorld(t)
	w.exec(t, `INSERT INTO assistant_settings (company_id, answer_when, reply_grace_minutes) VALUES ($1, 'when_away', 5)`, w.company.String())
	w.answerInTheApp(t, "b-1")
	if w.count(t, `SELECT count(*) FROM conversations WHERE company_id = $1 AND id = $2 AND handled_by = 'assistant' AND assistant_due_at IS NULL`) != 1 {
		t.Fatal("not taken over; ansa no longer waits to step in")
	}
	if w.count(t, `SELECT count(*) FROM messages WHERE company_id = $1 AND conversation_id = $2 AND id = '`+w.draftID+`' AND send_status = 'discarded'`) != 1 {
		t.Fatal("ansa's waiting reply never goes after the business's own answer")
	}
	if w.count(t, `SELECT count(*) FROM assistant_activity WHERE company_id = $1 AND conversation_id = $2 AND action = 'taken_over'`) != 0 {
		t.Fatal("no take over")
	}
}
