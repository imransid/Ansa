package assistant

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/chat"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// replyWorld is one test company with a stand-in chat, a fake brain that
// answers `brainAnswer` (never the real model), and the runner.
type replyWorld struct {
	t          *testing.T
	pool       *database.Pool
	box        *secure.Box
	companyID  string
	company    tenant.CompanyID
	runner     *Runner
	outbox     string
	brainCalls int
	sent       []BrainRequest
	// What the fake brain answers next ("" = it is down).
	brainAnswer string
}

func newReplyWorld(t *testing.T, brainAnswer string) *replyWorld {
	pool := database.ForTest(t)
	w := &replyWorld{t: t, pool: pool, outbox: t.TempDir(), brainAnswer: brainAnswer}
	w.companyID = database.TestCompany(t, pool)
	w.company, _ = tenant.FromTrustedSource(w.companyID)
	w.box, _ = secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		w.brainCalls++
		var request BrainRequest
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &request)
		w.sent = append(w.sent, request)
		if w.brainAnswer == "" {
			rw.WriteHeader(http.StatusInternalServerError)
			return
		}
		rw.Header().Set("Content-Type", "application/json")
		io.WriteString(rw, w.brainAnswer)
	}))
	t.Cleanup(brain.Close)
	limiter := ratelimit.New(pool, "core-test-secret")
	w.runner = &Runner{
		Pool: pool, Box: w.box, Limiter: limiter,
		Brain: brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second),
		Chat:  &chat.Sender{StandInsAllowed: true, StandInDir: w.outbox},
		Log:   logging.New(io.Discard),
	}
	mustExec(t, pool, `UPDATE companies SET name = 'Luigi''s' WHERE id = $1`, w.companyID)
	mustExec(t, pool, `INSERT INTO catalog_items (company_id, category, name, price_cents, position) VALUES ($1, 'Pizza', 'Margherita', 950, 1)`, w.companyID)
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, limiter.Key("assistant-replies", w.companyID))
	})
	return w
}

func (w *replyWorld) customerSays(externalID, text string) conversations.Turn {
	id, _ := conversations.NewID()
	body, _ := w.box.Encrypt(text, conversations.MessageContext(w.company, id))
	turn, err := conversations.InsertCustomerMessage(context.Background(), w.pool, w.company,
		conversations.ContactKey{Channel: conversations.ChannelStandIn, ExternalID: externalID}, conversations.IncomingMessage{ID: id, BodyEncrypted: body, ChannelMessageID: id})
	if err != nil || turn == nil {
		w.t.Fatalf("saving the customer's message: %v", err)
	}
	w.t.Cleanup(func() {
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, w.runner.Limiter.Key("assistant-customer", turn.ConversationID))
	})
	return *turn
}

func (w *replyWorld) answer(turn conversations.Turn) string {
	outcome, err := w.runner.Answer(context.Background(), turn, false)
	if err != nil {
		w.t.Fatalf("Answer: %v", err)
	}
	return outcome
}

// assistantMessages are the assistant's messages: status and decrypted text.
func (w *replyWorld) assistantMessages(turn conversations.Turn) [][2]string {
	rows, err := w.pool.Query(context.Background(), `SELECT id, send_status, body_encrypted FROM messages WHERE company_id = $1 AND conversation_id = $2 AND author = 'assistant' ORDER BY created_at`, w.companyID, turn.ConversationID)
	if err != nil {
		w.t.Fatalf("reading messages: %v", err)
	}
	var result [][2]string
	for rows.Next() {
		var id, status, body string
		rows.Scan(&id, &status, &body)
		text, _ := w.box.Decrypt(body, conversations.MessageContext(w.company, id))
		result = append(result, [2]string{status, text})
	}
	return result
}

func (w *replyWorld) count(statement string, args ...any) int {
	var n int
	if err := w.pool.QueryRow(context.Background(), statement, args...).Scan(&n); err != nil {
		w.t.Fatalf("count: %v", err)
	}
	return n
}

func TestAReplyThatPassesGoesOutOnceWithTheAILabel(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"reply","text":"Yes, a Margherita is €9.50."}`)
	turn := w.customerSays("ana", "How much is a pizza?")
	if got := w.answer(turn); got != OutcomeReplied {
		t.Fatalf("outcome: %s", got)
	}
	messages := w.assistantMessages(turn)
	if len(messages) != 1 || messages[0] != [2]string{"sent", "I'm the AI assistant for Luigi's.\nYes, a Margherita is €9.50."} {
		t.Fatalf("messages: %+v", messages)
	}
	if files, _ := os.ReadDir(w.outbox); len(files) != 1 {
		t.Fatalf("the stand-in got %d messages", len(files))
	}
	if w.sent[0].Engine != "api_key" || w.sent[0].APIKey != nil {
		t.Fatal("no own key: ansa's key answers (the brain's own)")
	}
	if got := w.answer(turn); got != OutcomeQuiet || w.brainCalls != 1 {
		t.Fatalf("answered twice: %s, %d brain calls", got, w.brainCalls)
	}
	if w.count(`SELECT count(*) FROM assistant_activity WHERE company_id = $1 AND action = 'replied'`, w.companyID) != 1 {
		t.Fatal("one 'replied' line")
	}
}

func TestAMadeUpPriceIsNeverSentAndAPersonIsAsked(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"reply","text":"Today it's only €5!"}`)
	turn := w.customerSays("bo", "Any deals?")
	if got := w.answer(turn); got != OutcomeHandedOver {
		t.Fatalf("outcome: %s", got)
	}
	messages := w.assistantMessages(turn)
	if len(messages) != 1 || !strings.HasSuffix(messages[0][1], "Our team will get back to you as soon as possible.") || messages[0][0] != "sent" {
		t.Fatalf("the holding reply, never the AI's text: %+v", messages)
	}
	var subject, description string
	w.pool.QueryRow(context.Background(), `SELECT subject, description FROM tickets WHERE company_id = $1 AND conversation_id = $2 AND status = 'open'`, w.companyID, turn.ConversationID).Scan(&subject, &description)
	if subject != "Stand-in chat conversation needs you" || !strings.HasPrefix(description, ReasonText["price_not_on_menu"]) {
		t.Fatalf("request: %q / %q", subject, description)
	}
	if w.count(`SELECT count(*) FROM assistant_activity WHERE company_id = $1 AND action = 'handed_over' AND reason = 'price_not_on_menu'`, w.companyID) != 1 {
		t.Fatal("the handover line with its reason")
	}
	if w.count(`SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'owner.alert' AND run_after > now()`, w.companyID) != 1 {
		t.Fatal("the owners' alert is queued, after the holding reply's send")
	}
	next := w.customerSays("bo", "Hello?")
	if got := w.answer(next); got != OutcomeQuiet || w.brainCalls != 1 {
		t.Fatalf("while the request is open the assistant stays quiet: %s", got)
	}
}

func TestTheAIsOwnRequestKeepsItsSubjectAndCategory(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"needs_person","reason":"complaint","subject":"Cold\u202epizza","summary":"The pizza arrived cold.","category":"Complaints"}`)
	mustExec(t, w.pool, `INSERT INTO categories (company_id, name) VALUES ($1, 'Complaints')`, w.companyID)
	turn := w.customerSays("cy", "My pizza was cold!")
	if got := w.answer(turn); got != OutcomeHandedOver {
		t.Fatalf("outcome: %s", got)
	}
	var subject, description string
	var category *string
	if err := w.pool.QueryRow(context.Background(), `SELECT subject, description, category FROM tickets WHERE company_id = $1 AND conversation_id = $2`, w.companyID, turn.ConversationID).Scan(&subject, &description, &category); err != nil {
		t.Fatalf("reading the request: %v", err)
	}
	if subject != "Coldpizza" || description != "They complained.\n\nThe pizza arrived cold." || category == nil || *category != "Complaints" {
		t.Fatalf("request: %q %q %v", subject, description, category)
	}
}

func TestPausedImportantAndAskFirst(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"reply","text":"We open at 18:00."}`)
	mustExec(t, w.pool, `INSERT INTO assistant_settings (company_id, status) VALUES ($1, 'paused')`, w.companyID)
	paused := w.customerSays("di", "When do you open?")
	if got := w.answer(paused); got != OutcomeQuiet || w.brainCalls != 0 {
		t.Fatalf("paused: %s", got)
	}
	mustExec(t, w.pool, `UPDATE assistant_settings SET status = 'on', reply_mode = 'ask_first' WHERE company_id = $1`, w.companyID)
	drafted := w.customerSays("ed", "When do you open?")
	if got := w.answer(drafted); got != OutcomeDrafted {
		t.Fatalf("ask first: %s", got)
	}
	if messages := w.assistantMessages(drafted); len(messages) != 1 || messages[0][0] != "draft" {
		t.Fatalf("a draft waits for a person: %+v", messages)
	}
	mustExec(t, w.pool, `UPDATE contacts SET important = true WHERE company_id = $1 AND external_id = 'fi'`, w.companyID)
	important := w.customerSays("fi", "It's me")
	mustExec(t, w.pool, `UPDATE contacts SET important = true WHERE company_id = $1 AND external_id = 'fi'`, w.companyID)
	calls := w.brainCalls
	if got := w.answer(important); got != OutcomeHandedOver || w.brainCalls != calls {
		t.Fatalf("an important person goes to the owner, no AI asked: %s", got)
	}
}

func TestWhenAwayTheAssistantWaitsForYouFirst(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"reply","text":"They'll be back soon."}`)
	mustExec(t, w.pool, `INSERT INTO assistant_settings (company_id, answer_when, reply_grace_minutes) VALUES ($1, 'when_away', 10)`, w.companyID)
	turn := w.customerSays("gi", "Are you there?")
	if got := w.answer(turn); got != OutcomeWaiting || w.brainCalls != 0 {
		t.Fatalf("outcome: %s", got)
	}
	if w.count(`SELECT count(*) FROM conversations WHERE company_id = $1 AND assistant_due_at > now() + interval '9 minutes'`, w.companyID) != 1 {
		t.Fatal("the catch-up looks again in 10 minutes")
	}
	outcome, err := w.runner.Answer(context.Background(), turn, true)
	if err != nil || outcome != OutcomeReplied {
		t.Fatalf("the catch-up's run answers: %s %v", outcome, err)
	}
}

func TestABrainThatIsDownGivesTheHoldingReply(t *testing.T) {
	w := newReplyWorld(t, "")
	turn := w.customerSays("ha", "Hi")
	if got := w.answer(turn); got != OutcomeHandedOver {
		t.Fatalf("outcome: %s", got)
	}
	if w.count(`SELECT count(*) FROM assistant_activity WHERE company_id = $1 AND reason = 'model_failed'`, w.companyID) != 1 {
		t.Fatal("handed over as model_failed")
	}
}

func TestAnUnreadableOwnKeyIsNeverReplacedByAnsas(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"reply","text":"Hi"}`)
	owner := database.TestOwner(t, w.pool, w.companyID)
	mustExec(t, w.pool, `INSERT INTO assistant_settings (company_id, anthropic_key_encrypted, anthropic_key_hint, updated_by_user_id) VALUES ($1, 'v1:AAAA:BBBB:CCCC', 'abcd', $2)`, w.companyID, owner)
	turn := w.customerSays("io", "Hi")
	if got := w.answer(turn); got != OutcomeHandedOver || w.brainCalls != 0 {
		t.Fatalf("outcome: %s, %d brain calls", got, w.brainCalls)
	}
}

func TestAnApprovedArticleReachesTheBrainAndItsPricesMayBeQuoted(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"reply","text":"Parking is €3 an hour behind the restaurant."}`)
	owner := database.TestOwner(t, w.pool, w.companyID)
	var articleID string
	w.pool.QueryRow(context.Background(), `INSERT INTO knowledge_articles (company_id, title, body, kind, status, created_by_user_id, updated_by_user_id, approved_by_user_id, approved_at)
		VALUES ($1, 'Parking', 'Parking costs €3 an hour behind the restaurant.', 'faq', 'approved', $2, $2, $2, now()) RETURNING id`, w.companyID, owner).Scan(&articleID)
	mustExec(t, w.pool, `INSERT INTO knowledge_chunks (company_id, article_id, position, heading, text) VALUES ($1, $2, 0, 'Parking', 'Parking costs €3 an hour behind the restaurant.')`, w.companyID, articleID)
	turn := w.customerSays("bo", "Where can I park my car?")
	if got := w.answer(turn); got != OutcomeReplied {
		t.Fatalf("a price the article states may be quoted: %s", got)
	}
	if !strings.Contains(w.sent[0].Knowledge, `<article title="Parking">`) {
		t.Fatalf("the brain read the article: %q", w.sent[0].Knowledge)
	}
}
