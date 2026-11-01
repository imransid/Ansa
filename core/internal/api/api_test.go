package api

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

	"ansa/core/internal/chat"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/inbox"
	"ansa/core/internal/logging"
	"ansa/core/internal/orders"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/session"
	"ansa/core/internal/tenant"
)

const (
	screensSecret = "screens-secret-for-core-tests-000000000"
	authSecret    = "better-auth-secret-for-core-tests-0000"
)

// apiWorld is one company with an owner logged in, a stand-in customer and
// a placed order, and core's API on a test server.
type apiWorld struct {
	t       *testing.T
	api     *Server
	pool    *database.Pool
	company tenant.CompanyID
	cookie  string
	orderID string
	outbox  string
	server  *httptest.Server
}

func newAPIWorld(t *testing.T) *apiWorld {
	pool := database.ForTest(t)
	w := &apiWorld{t: t, pool: pool, outbox: t.TempDir()}
	companyID := database.TestCompany(t, pool)
	w.company, _ = tenant.FromTrustedSource(companyID)
	owner := database.TestOwner(t, pool, companyID)
	ctx := context.Background()
	token, _ := conversations.NewID()
	w.must(`INSERT INTO sessions (id, token, expires_at, user_id) VALUES ($1, $1, now() + interval '1 day', $2)`, token, owner)
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM sessions WHERE token = $1`, token) })
	w.cookie = "better-auth.session_token=" + session.SignValue(token, authSecret)
	box, _ := secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	messageID, _ := conversations.NewID()
	turn, _ := conversations.InsertCustomerMessage(ctx, pool, w.company, conversations.ContactKey{Channel: conversations.ChannelStandIn, ExternalID: "lena"},
		conversations.IncomingMessage{ID: messageID, BodyEncrypted: "v1:x:y:z", ChannelMessageID: "a1"})
	w.orderID, _ = conversations.NewID()
	address, _ := box.Encrypt("Via Roma 1", orders.FieldContext(w.company, w.orderID, "address"))
	w.must(`INSERT INTO orders (id, company_id, conversation_id, status, fulfilment, address_encrypted, wanted_time, currency, subtotal_cents, delivery_fee_cents, total_cents, order_number, placed_at)
		VALUES ($1, $2, $3, 'new', 'delivery', $4, '20:00', 'EUR', 1900, 250, 2150, 1, now())`, w.orderID, companyID, turn.ConversationID, address)
	w.must(`INSERT INTO order_items (company_id, order_id, position, name, quantity, unit_price_cents, line_total_cents) VALUES ($1, $2, 1, 'Margherita', 2, 950, 1900)`, companyID, w.orderID)
	limiter := ratelimit.New(pool, authSecret)
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM rate_limits WHERE key = $1`, limiter.Key("inbox-changes", owner)) })
	sender := &chat.Sender{StandInsAllowed: true, StandInDir: w.outbox}
	server := &Server{Pool: pool, Box: box, Limiter: limiter, Log: logging.New(io.Discard), Secret: screensSecret,
		Sessions: &session.Reader{Pool: pool, Secret: authSecret}, Orders: &orders.StatusChange{Pool: pool, Box: box, Sender: sender},
		Replies: &inbox.Replies{Pool: pool, Box: box, Sender: sender}}
	w.api = server
	routes := http.NewServeMux()
	server.Register(routes)
	w.server = httptest.NewServer(routes)
	t.Cleanup(w.server.Close)
	return w
}

func (w *apiWorld) must(statement string, args ...any) {
	if _, err := w.pool.Exec(context.Background(), statement, args...); err != nil {
		w.t.Fatalf("setup: %v", err)
	}
}

// call sends a request as the screens do: signed, with the person's cookie.
func (w *apiWorld) call(method, path, body, secret, cookie string) (int, map[string]any) {
	request, _ := http.NewRequest(method, w.server.URL+path, strings.NewReader(body))
	timestamp, signature := SignRequest(secret, method, path, []byte(body), time.Now())
	request.Header.Set("X-Ansa-Timestamp", timestamp)
	request.Header.Set("X-Ansa-Signature", signature)
	if cookie != "" {
		request.Header.Set("Cookie", cookie)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		w.t.Fatalf("request: %v", err)
	}
	defer response.Body.Close()
	var answer map[string]any
	json.NewDecoder(response.Body).Decode(&answer)
	return response.StatusCode, answer
}

func TestOnlyTheScreensWithALoggedInPersonGetIn(t *testing.T) {
	w := newAPIWorld(t)
	if code, _ := w.call("GET", "/api/v1/orders", "", "another-secret-another-secret-another", w.cookie); code != 403 {
		t.Fatalf("not signed by the screens: %d", code)
	}
	if code, _ := w.call("GET", "/api/v1/orders", "", screensSecret, ""); code != 401 {
		t.Fatalf("nobody logged in: %d", code)
	}
	code, answer := w.call("GET", "/api/v1/orders", "", screensSecret, w.cookie)
	open, _ := answer["open"].([]any)
	if code != 200 || len(open) != 1 {
		t.Fatalf("the company's orders: %d %v", code, answer)
	}
	first := open[0].(map[string]any)
	if first["address"] != "Via Roma 1" || first["totalCents"] != 2150.0 || len(first["lines"].([]any)) != 1 {
		t.Fatalf("the order as the page shows it: %v", first)
	}
}

func TestAcceptingTellsTheCustomerOnceAndASecondPressFindsItChanged(t *testing.T) {
	w := newAPIWorld(t)
	path := "/api/v1/orders/" + w.orderID + "/status"
	if code, answer := w.call("POST", path, `{"change":"accept"}`, screensSecret, w.cookie); code != 200 || answer["notice"] != "" {
		t.Fatalf("accepted: %d %v", code, answer)
	}
	files, _ := os.ReadDir(w.outbox)
	if len(files) != 1 {
		t.Fatalf("the customer is told once: %d", len(files))
	}
	page, _ := os.ReadFile(w.outbox + "/" + files[0].Name())
	if !strings.Contains(string(page), "Your order #1 is accepted.") {
		t.Fatal("ansa's fixed status message")
	}
	if code, answer := w.call("POST", path, `{"change":"accept"}`, screensSecret, w.cookie); code != 409 || !strings.Contains(answer["error"].(string), "changed this order meanwhile") {
		t.Fatalf("a second press: %d %v", code, answer)
	}
	if code, _ := w.call("POST", path, `{"change":"accept","companyId":"x"}`, screensSecret, w.cookie); code != 404 {
		t.Fatal("an unknown field is refused: the company only ever comes from the session")
	}
}

// serverAPI is the API behind the test server (a test may give it more parts).
func (w *apiWorld) serverAPI() *Server { return w.api }

func (w *apiWorld) count(statement string) int {
	var n int
	if err := w.pool.QueryRow(context.Background(), statement, w.company.String()).Scan(&n); err != nil {
		w.t.Fatalf("count: %v", err)
	}
	return n
}
