package whatsapp

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
)

func sign(body string) string {
	mac := hmac.New(sha256.New, []byte(appSecret))
	mac.Write([]byte(body))
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// hookWorld is a company with a connected number (a random id, so the
// shared local database never clashes) and the webhook.
type hookWorld struct {
	*numberWorld
	phone string
	hook  *Webhook
}

func newHookWorld(t *testing.T) *hookWorld {
	w := &hookWorld{numberWorld: newNumberWorld(t), phone: randomPhoneID()}
	newFakeGraph(t, newMetaSays(w.phone).answer)
	if _, err := w.connector.Connect(context.Background(), w.company, w.owner, signup(w.phone)); err != nil {
		t.Fatal(err)
	}
	limiter := ratelimit.New(w.pool, strings.Repeat("r", 40))
	w.hook = &Webhook{Pool: w.pool, Limiter: limiter, Box: w.box, Log: logging.New(io.Discard), AppSecret: appSecret, VerifyToken: strings.Repeat("v", 40)}
	return w
}

func (w *hookWorld) post(signature, body string) int {
	r := httptest.NewRequest(http.MethodPost, "/webhooks/whatsapp", strings.NewReader(body))
	r.Header.Set("X-Hub-Signature-256", signature)
	r.RemoteAddr = "198.51.100.11:1"
	res := httptest.NewRecorder()
	w.hook.ServeHTTP(res, r)
	return res.Code
}

func (w *hookWorld) count(t *testing.T, statement string) int {
	var n int
	if err := w.pool.QueryRow(context.Background(), statement, w.companyID).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

func (w *hookWorld) text(id, words string) string {
	return messagesBody(w.phone, `{"from":"16315551181","from_user_id":"`+userID+`","id":"`+id+`","type":"text","text":{"body":"`+words+`"}}`)
}

// Only Meta's signature lets a message in; it joins the customer's
// conversation once per WhatsApp message id, with their name, and the
// assistant's answer is queued.
func TestOnlyMetasSignatureLetsAWhatsAppMessageIn(t *testing.T) {
	w := newHookWorld(t)
	body := w.text("wamid.a1", "Are you open tonight?")
	if w.post("sha256=00", body) != 401 || w.post("", body) != 401 {
		t.Fatal("a bad or missing signature is refused")
	}
	if w.count(t, `SELECT count(*) FROM messages WHERE company_id = $1`) != 0 {
		t.Fatal("nothing is saved before the signature")
	}
	first := w.post(sign(body), body)
	again := w.post(sign(body), body)
	if first != 200 || again != 200 {
		t.Fatal("a signed message is taken, and Meta's second delivery of it too")
	}
	if w.count(t, `SELECT count(*) FROM messages WHERE company_id = $1 AND author = 'customer' AND body_encrypted LIKE 'v1:%'`) != 1 ||
		w.count(t, `SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'assistant.reply'`) != 1 {
		t.Fatal("saved once, encrypted, and the assistant's answer queued")
	}
	if w.count(t, `SELECT count(*) FROM contacts WHERE company_id = $1 AND channel = 'whatsapp' AND external_id = '`+w.phone+`:`+userID+`' AND display_name = 'Sheena Nelson'`) != 1 {
		t.Fatal("the customer is <number>:<business-scoped id>, with their name")
	}
	notForAnsa := `{"object":"whatsapp_business_account","entry":[{"id":"1","changes":[{"field":"messages","value":{"metadata":{"phone_number_id":"x"},"messages":[{}]}}]}]}`
	if w.post(sign(notForAnsa), notForAnsa) != 200 {
		t.Fatal("a body ansa can't read is answered 200 (Meta would send it again and again)")
	}
}

// The business's own message from the WhatsApp Business app: saved as
// "written in WhatsApp", and the assistant stops waiting to step in.
func TestAnEchoFromTheAppMeansYouAnswered(t *testing.T) {
	w := newHookWorld(t)
	body := w.text("wamid.c1", "Hi!")
	w.post(sign(body), body)
	w.pool.Exec(context.Background(), `UPDATE conversations SET assistant_due_at = now() + interval '5 minutes' WHERE company_id = $1`, w.companyID)
	echo := `{"object":"whatsapp_business_account","entry":[{"id":"777","changes":[{"field":"smb_message_echoes","value":{"metadata":{"phone_number_id":"` + w.phone +
		`"},"message_echoes":[{"from":"15550783881","to_user_id":"` + userID + `","to":"16315551181","id":"wamid.e1","type":"text","text":{"body":"On my way!"}}]}}]}]}`
	if w.post(sign(echo), echo) != 200 {
		t.Fatal("an echo is taken")
	}
	if w.count(t, `SELECT count(*) FROM messages WHERE company_id = $1 AND author = 'business_account' AND send_status = 'sent'`) != 1 ||
		w.count(t, `SELECT count(*) FROM conversations WHERE company_id = $1 AND assistant_due_at IS NULL`) != 1 ||
		w.count(t, `SELECT count(*) FROM conversations WHERE company_id = $1`) != 1 {
		t.Fatal("in the customer's own conversation, and the assistant no longer waits to answer")
	}
	if w.count(t, `SELECT count(*) FROM conversations WHERE company_id = $1 AND handled_by = 'person' AND taken_over_by_user_id = '`+w.owner+`'`) != 1 {
		t.Fatal("ansa answers always here: the business answering in its app takes the conversation over, in the name of who connected the number")
	}
}

// Meta ends the link to the business account (the business removed ansa,
// or its number left the app): nothing more arrives or goes, until Meta
// restores it; a number an owner disconnected stays disconnected.
func TestMetaEndingTheLinkStopsTheNumber(t *testing.T) {
	w := newHookWorld(t)
	removed := `{"object":"whatsapp_business_account","entry":[{"id":"1","changes":[{"field":"account_update","value":{"event":"PARTNER_REMOVED","waba_info":{"waba_id":"777"}}}]}]}`
	w.post(sign(removed), removed)
	if w.count(t, `SELECT count(*) FROM whatsapp_numbers WHERE company_id = $1 AND status = 'removed_in_whatsapp' AND token_encrypted IS NOT NULL`) != 1 {
		t.Fatal("removed on Meta's side (the token kept for a reconnection)")
	}
	body := w.text("wamid.r1", "Hello?")
	if w.post(sign(body), body) != 200 || w.count(t, `SELECT count(*) FROM messages WHERE company_id = $1`) != 0 {
		t.Fatal("a message for a number removed on Meta's side is ignored")
	}
	reconnected := `{"object":"whatsapp_business_account","entry":[{"id":"777","changes":[{"field":"account_update","value":{"event":"ACCOUNT_RECONNECTED"}}]}]}`
	w.post(sign(reconnected), reconnected)
	if w.count(t, `SELECT count(*) FROM whatsapp_numbers WHERE company_id = $1 AND status = 'connected'`) != 1 {
		t.Fatal("Meta restored it")
	}
	Disconnect(context.Background(), w.pool, w.company, w.owner)
	w.post(sign(reconnected), reconnected)
	if w.count(t, `SELECT count(*) FROM whatsapp_numbers WHERE company_id = $1 AND status = 'disconnected'`) != 1 {
		t.Fatal("an owner's disconnect is final")
	}
}

// Meta's setup check gets its challenge back only with ansa's verify token.
func TestTheSetupCheckNeedsTheVerifyToken(t *testing.T) {
	hook := &Webhook{Log: logging.New(io.Discard), VerifyToken: strings.Repeat("v", 40)}
	check := func(query string) (int, string) {
		res := httptest.NewRecorder()
		hook.Verify(res, httptest.NewRequest(http.MethodGet, "/webhooks/whatsapp?"+query, nil))
		return res.Code, res.Body.String()
	}
	if code, body := check("hub.mode=subscribe&hub.verify_token=" + strings.Repeat("v", 40) + "&hub.challenge=abc123"); code != 200 || body != "abc123" {
		t.Fatalf("the right token: %d %q", code, body)
	}
	if code, _ := check("hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123"); code != 403 {
		t.Fatal("a wrong token is refused")
	}
	hook.VerifyToken = ""
	if code, _ := check("hub.mode=subscribe&hub.verify_token=&hub.challenge=abc123"); code != 403 {
		t.Fatal("without a verify token every check is refused")
	}
}
