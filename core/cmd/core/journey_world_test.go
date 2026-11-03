package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/api"
	"ansa/core/internal/config"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/telegram"
)

// journey is core as the server runs it (assemble, the same wiring as main)
// on the test database, with a fake brain and a fake Telegram API, driven
// through its own routes the way the screens, Telegram and the queue do.
type journey struct {
	t        *testing.T
	pool     *database.Pool
	core     *parts
	server   *httptest.Server
	dev      string
	brain    *fakeBrain
	telegram *fakeTelegram
	limiter  *ratelimit.Limiter
	// This run's own browser address and email domain: two runs on the same
	// database never share a counter or clean up each other's people.
	ip, domain string
	// Everything the run's counters are keyed by, and the Telegram business
	// connections it made (a refused one waits in a table of no company).
	identifiers, telegramConnections []string
}

const (
	journeyScreensSecret  = "journey-screens-secret-0000000000000000"
	journeyTelegramSecret = "journey-telegram-secret-000000000000000"
)

func newJourney(t *testing.T) *journey {
	// As every test answering for Telegram with a fake: never with a real
	// bot's token around.
	if os.Getenv("TELEGRAM_BOT_TOKEN") != "" {
		t.Fatal("TELEGRAM_BOT_TOKEN is set, so this test could reach Telegram. Leave it unset to run it.")
	}
	pool := database.ForTest(t)
	id, _ := conversations.NewID()
	j := &journey{t: t, pool: pool, dev: t.TempDir(), brain: newFakeBrain(t), telegram: newFakeTelegram(t),
		ip: "journey-" + id[:12], domain: id[:12] + ".journey-test.example"}
	settings := map[string]string{
		"DATABASE_URL": os.Getenv("TEST_DATABASE_URL"), "DATA_ENCRYPTION_KEY": "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
		"BRAIN_URL": j.brain.server.URL, "BRAIN_SHARED_SECRET": strings.Repeat("b", 40), "ANSA_ENV": "development",
		"BETTER_AUTH_SECRET": "journey-auth-secret-" + id, "SCREENS_SHARED_SECRET": journeyScreensSecret, "APP_URL": "https://app.ansa.test",
		"TELEGRAM_BOT_TOKEN": "123456:journey-test-token", "TELEGRAM_BOT_USERNAME": "ansa_journey_bot", "TELEGRAM_WEBHOOK_SECRET": journeyTelegramSecret,
		"ANSA_DEV_FOLDER": j.dev,
	}
	cfg, err := config.Load(func(name string) string { return settings[name] })
	if err != nil {
		t.Fatalf("settings: %v", err)
	}
	box, _ := secure.NewBox(cfg.DataEncryptionKey)
	realTelegram := telegram.APIHost
	telegram.APIHost = j.telegram.server.URL
	j.core = assemble(cfg, pool, box, logging.New(io.Discard))
	// Posts an answer made due ("Post one now") go out right after it, in a
	// goroutine of their own on the server; here before the answer, so the
	// test reads them at once (the runner's own hook for tests).
	j.core.publisher.After = func(work func()) { work() }
	j.server = httptest.NewServer(j.core.routes)
	j.limiter = ratelimit.New(pool, cfg.AuthSecret)
	j.identifiers = []string{j.ip}
	t.Cleanup(func() {
		j.server.Close()
		telegram.APIHost = realTelegram
		j.cleanUp()
	})
	return j
}

// call sends a request as the screens do: signed, with the person's cookies.
func (j *journey) call(method, path, body, cookie string) (int, map[string]any) {
	request, _ := http.NewRequest(method, j.server.URL+path, strings.NewReader(body))
	timestamp, signature := api.SignRequest(journeyScreensSecret, method, path, []byte(body), time.Now())
	request.Header.Set("X-Ansa-Timestamp", timestamp)
	request.Header.Set("X-Ansa-Signature", signature)
	request.Header.Set("Cookie", cookie)
	return j.send(request)
}

// telegramSends posts an update to the webhook as Telegram does.
func (j *journey) telegramSends(update string) {
	request, _ := http.NewRequest(http.MethodPost, j.server.URL+"/webhooks/telegram", strings.NewReader(update))
	request.Header.Set("X-Telegram-Bot-Api-Secret-Token", journeyTelegramSecret)
	if code, _ := j.send(request); code != http.StatusOK {
		j.t.Fatalf("Telegram's update was refused: %d", code)
	}
}

func (j *journey) send(request *http.Request) (int, map[string]any) {
	request.Header.Set("X-Forwarded-For", j.ip)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		j.t.Fatalf("request: %v", err)
	}
	defer response.Body.Close()
	var answer map[string]any
	json.NewDecoder(response.Body).Decode(&answer)
	return response.StatusCode, answer
}

// runJobs runs the company's queued jobs now (the reply's settling wait and
// the alerts' delay skipped) until none is left, as core's workers would.
func (j *journey) runJobs(companyID string) {
	ctx := context.Background()
	j.core.worker.OnlyCompany = companyID
	for range 50 {
		if _, err := j.pool.Exec(ctx, `UPDATE core_jobs SET run_after = now() WHERE company_id = $1 AND status = 'queued'`, companyID); err != nil {
			j.t.Fatalf("jobs: %v", err)
		}
		worked, err := j.core.worker.RunOnce(ctx)
		if err != nil {
			j.t.Fatalf("jobs: %v", err)
		}
		if !worked {
			return
		}
	}
	j.t.Fatal("jobs kept coming")
}

// newestEmailLink is the "#..." link of the newest email to address (in the
// development folder, as the stand-in writes it).
func (j *journey) newestEmailLink(address string) string {
	files, _ := filepath.Glob(filepath.Join(j.dev, ".dev-emails", "*"))
	sort.Strings(files)
	for i := len(files) - 1; i >= 0; i-- {
		page, _ := os.ReadFile(files[i])
		if strings.Contains(string(page), address) {
			if found := emailLink.FindStringSubmatch(string(page)); found != nil {
				return found[1]
			}
		}
	}
	j.t.Fatalf("no email with a link to %s", address)
	return ""
}

var emailLink = regexp.MustCompile(`verify-email#([A-Za-z0-9_.-]+)`)

// cleanUp deletes the run's companies (made by its signups), their people
// and the counters the run used.
func (j *journey) cleanUp() {
	ctx := context.Background()
	rows, _ := j.pool.Query(ctx, `SELECT DISTINCT company_id::text FROM users WHERE email LIKE $1`, "%@"+j.domain)
	var companies []string
	for rows.Next() {
		var id string
		rows.Scan(&id)
		companies = append(companies, id)
	}
	rows.Close()
	j.pool.Exec(ctx, `DELETE FROM verifications WHERE value IN (SELECT id FROM users WHERE email LIKE $1)`, "%@"+j.domain)
	j.pool.Exec(ctx, `DELETE FROM telegram_pending_connections WHERE external_id = ANY($1)`, j.telegramConnections)
	// The assistant counts its replies per conversation too.
	conversationRows, _ := j.pool.Query(ctx, `SELECT id::text FROM conversations WHERE company_id::text = ANY($1)`, companies)
	for conversationRows.Next() {
		var id string
		conversationRows.Scan(&id)
		j.identifiers = append(j.identifiers, id)
	}
	conversationRows.Close()
	for _, company := range companies {
		if err := database.DeleteTestCompany(ctx, j.pool, company); err != nil {
			j.t.Errorf("cleaning a company: %v", err)
		}
	}
	var keys []string
	for _, action := range limitActions {
		for _, identifier := range j.identifiers {
			keys = append(keys, j.limiter.Key(action, identifier))
		}
	}
	j.pool.Exec(ctx, `DELETE FROM rate_limits WHERE key = ANY($1)`, keys)
}

// Every action core counts (grep "Over(ctx" in internal/): the cleanup
// deletes this run's counter of each, whatever the journey touched.
var limitActions = []string{"account-changes", "assistant-call", "assistant-customer", "assistant-replies", "autopost-now", "inbox-changes",
	"login-device", "login-email", "login-email-ip", "login-ip", "menu-changes", "owner-alerts", "publish-attempts", "publishing-changes",
	"settings-changes", "signup", "social-accounts", "telegram-bot-chat", "telegram-webhook", "verify-email", "verification-email", "trial", "login"}
