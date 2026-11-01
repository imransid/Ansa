package messenger

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/social"
	"ansa/core/internal/tenant"
)

const appSecret = "meta-app-secret-for-tests"

func sign(body string) string {
	mac := hmac.New(sha256.New, []byte(appSecret))
	mac.Write([]byte(body))
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

func TestEventsAreReadStrictly(t *testing.T) {
	body := `{"object":"page","entry":[{"id":"111","messaging":[
		{"sender":{"id":"222"},"recipient":{"id":"111"},"message":{"mid":"m1","text":"Hi"}},
		{"sender":{"id":"222"},"recipient":{"id":"111"},"read":{"watermark":1}},
		{"sender":{"id":"111"},"recipient":{"id":"222"},"message":{"mid":"m2","is_echo":true,"app_id":987,"attachments":[{"type":"image"}]}}]}]}`
	events, err := ParseEvents([]byte(body))
	if err != nil || len(events) != 2 || events[1].AppID != "987" || events[1].Describe() != "[A photo: open Messenger to see it]" {
		t.Fatalf("events: %+v %v", events, err)
	}
	for _, bad := range []string{`{"object":"user","entry":[]}`, `{"object":"page","entry":[{"id":"abc"}]}`, `not json`} {
		if _, err := ParseEvents([]byte(bad)); err != ErrNotForAnsa {
			t.Fatalf("%s: %v", bad, err)
		}
	}
	if page, psid, ok := SplitContactID("dev:stand-in:lena"); !ok || page != "dev:stand-in" || psid != "lena" {
		t.Fatal("split at the last colon")
	}
}

func TestLongRepliesGoAsPartsCutBetweenWords(t *testing.T) {
	text := strings.Repeat("word ", 900)
	parts := SplitText(text)
	if len(parts) != 3 {
		t.Fatalf("%d parts", len(parts))
	}
	words := 0
	for _, part := range parts {
		if len([]rune(part)) > TextMax {
			t.Fatalf("a part of %d characters", len([]rune(part)))
		}
		for _, word := range strings.Fields(part) {
			if word != "word" {
				t.Fatalf("a word was cut: %q", word)
			}
			words++
		}
	}
	if words != 900 {
		t.Fatalf("%d words arrived, not 900", words)
	}
}

// pageWorld is a company with a connected Facebook Page (a random id, so the
// shared local database never clashes) and the webhook.
type pageWorld struct {
	pool    *database.Pool
	box     *secure.Box
	company tenant.CompanyID
	pageID  string
	conn    string
	hook    *Webhook
}

func newPageWorld(t *testing.T) *pageWorld {
	pool := database.ForTest(t)
	w := &pageWorld{pool: pool, pageID: fmt.Sprint(rand.Uint64())}
	companyID := database.TestCompany(t, pool)
	w.company, _ = tenant.FromTrustedSource(companyID)
	owner := database.TestOwner(t, pool, companyID)
	w.box, _ = secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	w.conn = w.connectPage(t, companyID, owner)
	limiter := ratelimit.New(pool, strings.Repeat("r", 40))
	w.hook = &Webhook{Pool: pool, Limiter: limiter, Box: w.box, Log: logging.New(io.Discard), AppID: "987", AppSecret: appSecret, VerifyToken: strings.Repeat("v", 40)}
	return w
}

func (w *pageWorld) connectPage(t *testing.T, companyID, owner string) string {
	var id string
	err := w.pool.QueryRow(context.Background(), `
		INSERT INTO social_connections (company_id, platform, external_account_id, display_name, account_kind, scopes, access_token_encrypted, connected_by_user_id)
		VALUES ($1, 'facebook', $2, 'Luigi''s', 'page', ARRAY['pages_messaging'], 'v1:x:y:z', $3) RETURNING id`, companyID, w.pageID, owner).Scan(&id)
	if err != nil {
		t.Fatalf("connecting the Page: %v", err)
	}
	company, _ := tenant.FromTrustedSource(companyID)
	token, _ := w.box.Encrypt("page-token", social.TokenContext(company, id, "access"))
	w.pool.Exec(context.Background(), `UPDATE social_connections SET access_token_encrypted = $3 WHERE company_id = $1 AND id = $2`, companyID, id, token)
	return id
}

func (w *pageWorld) post(signature, body string) int {
	r := httptest.NewRequest(http.MethodPost, "/webhooks/messenger", strings.NewReader(body))
	r.Header.Set("X-Hub-Signature-256", signature)
	r.RemoteAddr = "198.51.100.10:1"
	res := httptest.NewRecorder()
	w.hook.ServeHTTP(res, r)
	return res.Code
}

func (w *pageWorld) message(mid, from, to, extra string) string {
	return fmt.Sprintf(`{"object":"page","entry":[{"id":"%s","messaging":[{"sender":{"id":"%s"},"recipient":{"id":"%s"},"message":{"mid":"%s","text":"Hello"%s}}]}]}`, w.pageID, from, to, mid, extra)
}

func (w *pageWorld) count(t *testing.T, statement string) int {
	var n int
	if err := w.pool.QueryRow(context.Background(), statement, w.company.String()).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

func TestOnlyMetasSignatureLetsAMessageIn(t *testing.T) {
	w := newPageWorld(t)
	body := w.message("m1", "4242", w.pageID, "")
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
	if w.count(t, `SELECT count(*) FROM messages WHERE company_id = $1 AND author = 'customer'`) != 1 {
		t.Fatal("saved once per mid")
	}
	if w.count(t, `SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind IN ('assistant.reply', 'messenger.name')`) != 2 {
		t.Fatal("the assistant's reply and the name are queued")
	}
	if w.count(t, `SELECT count(*) FROM contacts WHERE company_id = $1 AND external_id LIKE '%:4242' AND channel = 'messenger'`) != 1 {
		t.Fatal("the customer is <page>:<psid>")
	}
}

func TestEchoesAndAPageInTwoCompanies(t *testing.T) {
	w := newPageWorld(t)
	own := w.message("e1", w.pageID, "4242", `,"is_echo":true,"app_id":987`)
	other := w.message("e2", w.pageID, "4242", `,"is_echo":true,"app_id":555`)
	w.post(sign(own), own)
	w.post(sign(other), other)
	if w.count(t, `SELECT count(*) FROM messages WHERE company_id = $1 AND author = 'business_account'`) != 1 {
		t.Fatal("ansa's own echo is skipped; the Page's own message is saved")
	}
	second := database.TestCompany(t, w.pool)
	w.connectPage(t, second, database.TestOwner(t, w.pool, second))
	body := w.message("m9", "777", w.pageID, "")
	w.post(sign(body), body)
	if w.count(t, `SELECT count(*) FROM messages WHERE company_id = $1 AND channel_message_id = 'm9'`) != 0 {
		t.Fatal("a Page connected in two companies decides nothing")
	}
}

func TestMetasSetupCheck(t *testing.T) {
	hook := &Webhook{Log: logging.New(io.Discard), VerifyToken: strings.Repeat("v", 40)}
	check := func(token string) (int, string) {
		r := httptest.NewRequest(http.MethodGet, "/webhooks/messenger?hub.mode=subscribe&hub.challenge=abc123&hub.verify_token="+token, nil)
		res := httptest.NewRecorder()
		hook.Verify(res, r)
		return res.Code, res.Body.String()
	}
	if code, body := check(strings.Repeat("v", 40)); code != 200 || body != "abc123" {
		t.Fatalf("right token: %d %q", code, body)
	}
	if code, _ := check("wrong"); code != 403 {
		t.Fatal("a wrong token is refused")
	}
}

func TestSendingAndTheNameThroughAFakeGraph(t *testing.T) {
	var requests []string
	graph := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.Method+" "+r.URL.Path)
		if r.URL.Query().Get("appsecret_proof") != AppSecretProof("page-token", appSecret) {
			rw.WriteHeader(400)
			return
		}
		switch {
		case r.Method == http.MethodGet:
			io.WriteString(rw, `{"first_name":"Lena","last_name":"Moretti"}`)
		case strings.Contains(r.URL.Path, "closed"):
			rw.WriteHeader(400)
			io.WriteString(rw, `{"error":{"code":10,"error_subcode":2018278,"message":"secret words"}}`)
		default:
			io.WriteString(rw, `{"recipient_id":"4242","message_id":"mid.1"}`)
		}
	}))
	defer graph.Close()
	old := GraphURL
	GraphURL = graph.URL
	defer func() { GraphURL = old }()
	ctx := context.Background()
	if got := Send(ctx, appSecret, "111", "page-token", "4242", strings.Repeat("word ", 900)); got.Status != "sent" || got.ChannelMessageID != "mid.1" || len(requests) != 3 {
		t.Fatalf("sent in 3 parts: %+v, %d requests", got, len(requests))
	}
	if got := Send(ctx, appSecret, "closed", "page-token", "4242", "Hi"); got.Status != "failed" || got.Error != "reply_window_closed" {
		t.Fatalf("outside 24 hours: %+v", got)
	}

	w := newPageWorld(t)
	body := w.message("m1", "4242", w.pageID, "")
	w.post(sign(body), body)
	var job jobs.Job
	w.pool.QueryRow(ctx, `SELECT id, payload FROM core_jobs WHERE company_id = $1 AND kind = $2`, w.company.String(), NameJobKind).Scan(&job.ID, &job.Payload)
	job.CompanyID = w.company
	if err := (&Names{Pool: w.pool, Box: w.box, AppSecret: appSecret}).HandleJob(ctx, &job); err != nil {
		t.Fatalf("name job: %v", err)
	}
	if w.count(t, `SELECT count(*) FROM contacts WHERE company_id = $1 AND display_name = 'Lena Moretti'`) != 1 {
		t.Fatal("the name is filled in once")
	}
}
