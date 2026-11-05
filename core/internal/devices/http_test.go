package devices

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
)

// appWorld is one account and the app's API on a test server; each test
// calls from an address of its own, so its pairing tries count alone.
type appWorld struct {
	*account
	limiter *ratelimit.Limiter
	server  *httptest.Server
	ip      string
}

func newAppWorld(t *testing.T) *appWorld {
	pool := database.ForTest(t)
	id, _ := conversations.NewID()
	w := &appWorld{account: newAccount(t, pool), limiter: ratelimit.New(pool, "device-tests-auth-secret-000000000000"), ip: "device-test-" + id}
	w.server = httptest.NewServer(OnlyDeviceRoutes(&API{Pool: pool, Limiter: w.limiter, Log: logging.New(io.Discard)}))
	t.Cleanup(w.server.Close)
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, w.limiter.Key("device-pair", w.ip))
	})
	return w
}

// call sends one request as the app does; token "" sends none.
func (w *appWorld) call(method, path, body, token string) (int, map[string]any) {
	w.t.Helper()
	request, _ := http.NewRequest(method, w.server.URL+path, strings.NewReader(body))
	request.Header.Set("X-Forwarded-For", w.ip)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		w.t.Fatalf("request: %v", err)
	}
	defer response.Body.Close()
	answer := map[string]any{}
	json.NewDecoder(response.Body).Decode(&answer)
	return response.StatusCode, answer
}

// The app's whole life: pair (the token once, with the status), check in,
// read its main screen, say "I'm away" and "I'm back", disconnect (then 401).
func TestThePhoneAppPairsChecksInAndDisconnects(t *testing.T) {
	w := newAppWorld(t)
	code := w.code()
	dashed := strings.ToLower(code[:4] + "-" + code[4:])
	status, answer := w.call("POST", "/device/v1/pair", `{"code":"`+dashed+`","name":"Rafa's iPhone","platform":"ios"}`, "")
	token, _ := answer["token"].(string)
	if status != 200 || len(token) != 43 || answer["deviceId"] == "" {
		t.Fatalf("paired: %d %v", status, answer)
	}
	want := map[string]any{"accountName": "core test company", "kind": "business", "state": "available", "awayBy": "", "since": "",
		"answersAlways": true, "followPhone": false, "waitMinutes": 5.0}
	if got := answer["status"].(map[string]any); !sameFields(got, want) {
		t.Fatalf("the status: %v", got)
	}
	if status, answer := w.call("POST", "/device/v1/pair", `{"code":"`+code+`","name":"again","platform":"ios"}`, ""); status != 400 ||
		answer["error"] != "That code isn't right, or it has expired. Show a new one on ansa's website." {
		t.Fatalf("the code again: %d %v", status, answer)
	}
	if status, answer := w.call("POST", "/device/v1/heartbeat", `{}`, token); status != 200 || answer["status"].(map[string]any)["state"] != "available" {
		t.Fatalf("check-in: %d %v", status, answer)
	}
	if status, answer := w.call("GET", "/device/v1/home", "", token); status != 200 || answer["needsYou"] != 0.0 || answer["activity"] == nil {
		t.Fatalf("home: %d %v", status, answer)
	}
	status, answer = w.call("POST", "/device/v1/away", `{"away":true}`, token)
	away := answer["status"].(map[string]any)
	if status != 200 || away["state"] != "away" || away["awayBy"] != "you" || !isTime(away["since"]) {
		t.Fatalf("I'm away, as the person: %d %v", status, answer)
	}
	if status, answer := w.call("POST", "/device/v1/away", `{"away":false}`, token); status != 200 || answer["status"].(map[string]any)["state"] != "available" {
		t.Fatalf("I'm back: %d %v", status, answer)
	}
	if status, _ := w.call("POST", "/device/v1/unpair", `{}`, token); status != 204 {
		t.Fatalf("unpair: %d", status)
	}
	if status, answer := w.call("POST", "/device/v1/heartbeat", `{}`, token); status != 401 || answer["error"] == "" {
		t.Fatalf("a removed phone: %d %v", status, answer)
	}
}

// The main screen: who needs a person (Home's condition), and what ansa did
// worded for people, the phones' own lines among them, newest first.
func TestTheMainScreenWordsWhatAnsaDid(t *testing.T) {
	w := newAppWorld(t)
	token, phone := w.phone("Rafa's iPhone")
	conversation := w.conversation("lena")
	w.exec(`UPDATE contacts SET display_name = 'Lena' WHERE company_id = $1`, w.company.String())
	w.exec(`INSERT INTO assistant_activity (company_id, conversation_id, action, created_at) VALUES ($1, $2, 'replied', now() - interval '1 minute')`,
		w.company.String(), conversation)
	w.exec(`INSERT INTO tickets (company_id, ticket_number, subject, description, channel, conversation_id) VALUES ($1, 1, 'Help', 'd', 'chat', $2)`,
		w.company.String(), conversation)
	w.follow(1)
	w.phoneSilentFor(phone, "2 minutes")
	runWatcher(t, w.pool)

	_, answer := w.call("GET", "/device/v1/home", "", token)
	activity := answer["activity"].([]any)
	newest, older := activity[0].(map[string]any), activity[1].(map[string]any)
	if answer["needsYou"] != 1.0 || len(activity) != 2 || answer["status"].(map[string]any)["awayBy"] != "phone" {
		t.Fatalf("the main screen: %v", answer)
	}
	if newest["text"] != "Your phone was unreachable: ansa answers for you" || newest["who"] != "" || !isTime(newest["at"]) {
		t.Fatalf("the phone's line first: %v", newest)
	}
	if older["text"] != "Answered a message" || older["who"] != "Lena" {
		t.Fatalf("ansa's line, as Home words it: %v", older)
	}
}

// Every refusal: no token, a made-up one, a strict body, a phone over its
// ceiling, and pairing tries over the per-IP limit.
func TestTheAppsRefusals(t *testing.T) {
	w := newAppWorld(t)
	token, phone := w.phone("Rafa's iPhone")
	for _, wrong := range []string{"", "made-up", strings.Repeat("x", 43)} {
		if status, answer := w.call("GET", "/device/v1/home", "", wrong); status != 401 || answer["error"] == "" {
			t.Fatalf("token %q: %d %v", wrong, status, answer)
		}
	}
	request, _ := http.NewRequest("GET", w.server.URL+"/device/v1/home", nil)
	request.Header.Set("Authorization", token)
	if response, err := http.DefaultClient.Do(request); err != nil || response.StatusCode != 401 {
		t.Fatalf("a token without \"Bearer \": %v %v", response, err)
	}
	if status, _ := w.call("POST", "/device/v1/away", `{"away":true,"companyId":"x"}`, token); status != 400 {
		t.Fatalf("an unknown field: %d", status)
	}
	if status, _ := w.call("POST", "/device/v1/pair", `{"code":"ABCDEFGH","name":"","platform":"ios"}`, ""); status != 400 {
		t.Fatalf("no name: %d", status)
	}
	if status, _ := w.call("POST", "/device/v1/pair", `{"code":"ABCDEFGH","name":"x","platform":"windows"}`, ""); status != 400 {
		t.Fatalf("an unknown platform: %d", status)
	}
	t.Cleanup(func() {
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, w.limiter.Key("device-calls", phone.ID))
	})
	saved := deviceCallLimit
	deviceCallLimit = ratelimit.Rule{MaxAttempts: 2, Window: time.Minute}
	t.Cleanup(func() { deviceCallLimit = saved })
	for range 2 {
		w.call("POST", "/device/v1/heartbeat", `{}`, token)
	}
	if status, _ := w.call("POST", "/device/v1/heartbeat", `{}`, token); status != 429 {
		t.Fatalf("over the phone's ceiling: %d", status)
	}
	for range pairLimit.MaxAttempts - 2 {
		w.call("POST", "/device/v1/pair", `{"code":"ABCDEFGH","name":"x","platform":"ios"}`, "")
	}
	if status, _ := w.call("POST", "/device/v1/pair", `{"code":"`+w.code()+`","name":"x","platform":"ios"}`, ""); status != 429 {
		t.Fatalf("pairing tries over the per-IP limit, even with a good code: %d", status)
	}
}

// The development LAN listener serves the app's routes and nothing else.
func TestTheLANListenerServesOnlyTheAppsRoutes(t *testing.T) {
	w := newAppWorld(t)
	for _, path := range []string{"/health", "/api/v1/home", "/webhooks/telegram", "/device/v2/home"} {
		if status, _ := w.call("GET", path, "", ""); status != 404 {
			t.Fatalf("%s: %d", path, status)
		}
	}
	if status, _ := w.call("GET", "/device/v1/home", "", ""); status != 401 {
		t.Fatalf("the app's route answers: %d", status)
	}
}

func sameFields(got, want map[string]any) bool {
	if len(got) != len(want) {
		return false
	}
	for key, value := range want {
		if got[key] != value {
			return false
		}
	}
	return true
}

func isTime(value any) bool {
	text, _ := value.(string)
	_, err := time.Parse(time.RFC3339, text)
	return err == nil
}
