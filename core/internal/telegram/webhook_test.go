package telegram

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

const testSecret = "telegram-test-secret-telegram-test-secret"

type fixture struct {
	pool      *database.Pool
	company   tenant.CompanyID
	webhook   *Webhook
	box       *secure.Box
	bcID      string
	accountID string
}

func newFixture(t *testing.T) *fixture {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	owner := database.TestOwner(t, pool, companyID)
	company, _ := tenant.FromTrustedSource(companyID)
	bcID, _ := conversations.NewID()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO channel_connections (company_id, channel, external_id, account_telegram_id, account_chat_id, display_name, connected_by_user_id)
		VALUES ($1, 'telegram', $2, '9001', '9001', 'Luigi', $3)`, companyID, bcID, owner)
	if err != nil {
		t.Fatalf("connecting: %v", err)
	}
	box, _ := secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	var logs bytes.Buffer
	hook := &Webhook{Pool: pool, Limiter: ratelimit.New(pool, strings.Repeat("r", 40)), Box: box, Log: logging.New(&logs), Secret: testSecret}
	return &fixture{pool: pool, company: company, webhook: hook, box: box, bcID: bcID, accountID: "9001"}
}

func (f *fixture) post(secret, body string) int {
	req := httptest.NewRequest(http.MethodPost, "/webhooks/telegram", strings.NewReader(body))
	req.Header.Set(secretHeader, secret)
	req.RemoteAddr = "198.51.100.9:1234"
	res := httptest.NewRecorder()
	f.webhook.ServeHTTP(res, req)
	return res.Code
}

func (f *fixture) businessMessage(id, fromID, text string) string {
	return `{"update_id":1,"business_message":{"message_id":` + id + `,"business_connection_id":"` + f.bcID + `",
		"chat":{"id":555,"type":"private","first_name":"Lena"},"from":{"id":` + fromID + `},"text":"` + text + `"}}`
}

func (f *fixture) count(t *testing.T, query string) int {
	var n int
	if err := f.pool.QueryRow(context.Background(), query, f.company.String()).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

func TestAWrongOrMissingSecretIsRefusedBeforeAnythingIsRead(t *testing.T) {
	f := newFixture(t)
	if code := f.post("wrong", f.businessMessage("1", "555", "hi")); code != 401 {
		t.Fatalf("wrong secret: %d", code)
	}
	if code := f.post("", "not even json"); code != 401 {
		t.Fatalf("no secret: %d", code)
	}
	if f.count(t, `SELECT count(*) FROM messages WHERE company_id = $1`) != 0 {
		t.Fatal("nothing may be saved")
	}
}

func TestACustomerMessageIsSavedOnceEncryptedAndQueuedForAReply(t *testing.T) {
	f := newFixture(t)
	for i := 0; i < 2; i++ {
		if code := f.post(testSecret, f.businessMessage("42", "555", "Are you open tonight?")); code != 200 {
			t.Fatalf("post %d: %d", i, code)
		}
	}
	var id, body string
	f.pool.QueryRow(context.Background(), `SELECT id, body_encrypted FROM messages WHERE company_id = $1 AND author = 'customer'`, f.company.String()).Scan(&id, &body)
	plain, err := f.box.Decrypt(body, conversations.MessageContext(f.company, id))
	if err != nil || plain != "Are you open tonight?" {
		t.Fatalf("stored text: %q %v", plain, err)
	}
	if f.count(t, `SELECT count(*) FROM messages WHERE company_id = $1`) != 1 || f.count(t, `SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'assistant.reply'`) != 1 {
		t.Fatal("one message and one reply job")
	}
	if code := f.post(testSecret, `{"update_id":1,"weird":true}`); code != 200 {
		t.Fatalf("an update ansa can't read is answered 200: %d", code)
	}
}

func TestTheBusinessOwnMessageAndTheBotsEchoAndDeletions(t *testing.T) {
	f := newFixture(t)
	f.post(testSecret, f.businessMessage("50", "555", "hello"))
	f.post(testSecret, f.businessMessage("51", f.accountID, "Hi Lena, yes we are!"))
	echo := `{"update_id":2,"business_message":{"message_id":52,"business_connection_id":"` + f.bcID + `","chat":{"id":555,"type":"private"},"from":{"id":9001},"text":"x","sender_business_bot":{"id":1}}}`
	f.post(testSecret, echo)
	if f.count(t, `SELECT count(*) FROM messages WHERE company_id = $1 AND author = 'business_account'`) != 1 || f.count(t, `SELECT count(*) FROM messages WHERE company_id = $1`) != 2 {
		t.Fatal("the owner's message saved as the business's; the bot's echo not saved")
	}
	deleted := `{"update_id":3,"deleted_business_messages":{"business_connection_id":"` + f.bcID + `","chat":{"id":555,"type":"private"},"message_ids":[50]}}`
	if code := f.post(testSecret, deleted); code != 200 || f.count(t, `SELECT count(*) FROM messages WHERE company_id = $1`) != 1 {
		t.Fatal("a message deleted in Telegram is deleted in ansa")
	}
}
