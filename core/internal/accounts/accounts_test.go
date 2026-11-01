package accounts

import (
	"context"
	"io"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/email"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/teammates"
	"ansa/core/internal/tenant"
)

// fakeMail keeps every email instead of sending it.
type fakeMail struct {
	mu   sync.Mutex
	sent []email.Message
}

func (f *fakeMail) Send(_ context.Context, m email.Message) email.Result {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sent = append(f.sent, m)
	return email.Result{OK: true}
}

func (f *fakeMail) AccountFromHeader() string { return `"ansa" <hello@ansa.test>` }

func (f *fakeMail) last(t *testing.T, to string) email.Message {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := len(f.sent) - 1; i >= 0; i-- {
		if f.sent[i].To == to {
			return f.sent[i]
		}
	}
	t.Fatalf("no email to %s", to)
	return email.Message{}
}

// countingLimiter is the real limiter, remembering its keys to clean them
// up (locked: a reset link is sent from its own goroutine).
type countingLimiter struct {
	*ratelimit.Limiter
	mu   sync.Mutex
	keys []string
}

func (c *countingLimiter) Over(ctx context.Context, action, identifier string, rule ratelimit.Rule) (bool, error) {
	c.mu.Lock()
	c.keys = append(c.keys, c.Key(action, identifier))
	c.mu.Unlock()
	return c.Limiter.Over(ctx, action, identifier, rule)
}

// usedKeys are the keys counted so far.
func (c *countingLimiter) usedKeys() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.keys...)
}

type accountsWorld struct {
	t       *testing.T
	service *Service
	mail    *fakeMail
	ip      string
}

func newAccountsWorld(t *testing.T) *accountsWorld {
	pool := database.ForTest(t)
	mail := &fakeMail{}
	limiter := &countingLimiter{Limiter: ratelimit.New(pool, "accounts-test-secret-of-32-characters")}
	ip, _ := conversations.NewID()
	w := &accountsWorld{t: t, mail: mail, ip: "test-" + ip,
		service: &Service{Pool: pool, Secret: "accounts-test-secret-of-32-characters", AppURL: "https://app.ansa.test", Mail: mail, Limits: limiter, Log: logging.New(io.Discard)}}
	t.Cleanup(func() {
		ctx := context.Background()
		pool.Exec(ctx, `DELETE FROM rate_limits WHERE key = ANY($1)`, limiter.usedKeys())
		rows, _ := pool.Query(ctx, `SELECT DISTINCT company_id FROM users WHERE email LIKE '%@accounts-test.example'`)
		var companies []string
		for rows.Next() {
			var id string
			rows.Scan(&id)
			companies = append(companies, id)
		}
		rows.Close()
		for _, statement := range []string{
			`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@accounts-test.example')`,
			`DELETE FROM accounts WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@accounts-test.example')`,
			`DELETE FROM verifications WHERE value IN (SELECT id FROM users WHERE email LIKE '%@accounts-test.example')`,
			`DELETE FROM invites WHERE email LIKE '%@accounts-test.example'`,
			`DELETE FROM users WHERE email LIKE '%@accounts-test.example' AND company_id::text = ANY($1)`,
			`DELETE FROM companies WHERE id::text = ANY($1) AND name = 'New business'`,
		} {
			if strings.Contains(statement, "$1") {
				pool.Exec(ctx, statement, companies)
			} else {
				pool.Exec(ctx, statement)
			}
		}
	})
	return w
}

func address() string {
	id, _ := conversations.NewID()
	return id[:8] + "@accounts-test.example"
}

var linkToken = regexp.MustCompile(`#([A-Za-z0-9_.-]+)`)

func tokenIn(message email.Message) string {
	return linkToken.FindStringSubmatch(message.Text)[1]
}

func TestSignupConfirmLoginAndAFriendlyLimit(t *testing.T) {
	w := newAccountsWorld(t)
	ctx := context.Background()
	r := Request{IP: w.ip, UserAgent: "test"}
	ana := address()
	if message, err := w.service.SignUp(ctx, NewPerson{Name: "Ana", Email: ana, Password: "a long password here"}, r); err != nil || message != "" {
		t.Fatalf("signup: %q %v", message, err)
	}
	link := w.mail.last(t, ana)
	if link.Subject != "Confirm your email address" || strings.Contains(link.Text, "Ana") || !strings.Contains(link.Text, "https://app.ansa.test/verify-email#") {
		t.Fatalf("the confirmation email never repeats the typed name: %q", link.Text)
	}
	if answer, _ := w.service.LogIn(ctx, ana, "a long password here", r); answer.Message != confirmFirst {
		t.Fatalf("no login before confirming: %+v", answer)
	}
	if again, _ := w.service.SignUp(ctx, NewPerson{Name: "Mallory", Email: ana, Password: "another password!!"}, r); again != "" || w.mail.last(t, ana).Subject != "You already have an ansa account" {
		t.Fatal("an existing address answers the same, and only the inbox is told")
	}
	if answer, _ := w.service.ConfirmEmail(ctx, tokenIn(link), "the wrong password", r); answer.Message != wrongLinkOrPwd {
		t.Fatal("a link alone confirms nobody")
	}
	answer, err := w.service.ConfirmEmail(ctx, tokenIn(link), "a long password here", r)
	if err != nil || len(answer.Cookies) != 2 || answer.Cookies[0].Name != "__Secure-better-auth.session_token" || !answer.Cookies[0].Secure {
		t.Fatalf("confirmed and logged in: %+v %v", answer, err)
	}
	var companyName, role string
	w.service.Pool.QueryRow(ctx, `SELECT companies.name, users.role FROM users JOIN companies ON companies.id = users.company_id WHERE users.email = $1`, ana).Scan(&companyName, &role)
	if companyName != "New business" || role != "owner" {
		t.Fatalf("a new company, owned: %s %s", companyName, role)
	}
	for i := 0; i < 10; i++ {
		w.service.LogIn(ctx, ana, "wrong password!", r)
	}
	if answer, _ := w.service.LogIn(ctx, ana, "a long password here", r); answer.Message != "Too many login attempts. Try again in 15 minutes." {
		t.Fatalf("ten wrong from one place: %+v", answer)
	}
	known := Request{IP: "test-elsewhere-" + w.ip, KnownDeviceCookie: answer.Cookies[1].Value}
	if answer, _ := w.service.LogIn(ctx, ana, "a long password here", known); len(answer.Cookies) != 2 {
		t.Fatal("a browser that logged in before still gets in from elsewhere")
	}
}

func TestResetChangesThePasswordOnceAndEndsEveryLogin(t *testing.T) {
	w := newAccountsWorld(t)
	ctx := context.Background()
	r := Request{IP: w.ip}
	bo := address()
	w.service.SignUp(ctx, NewPerson{Name: "Bo", Email: bo, Password: "first password ok"}, r)
	w.service.ConfirmEmail(ctx, tokenIn(w.mail.last(t, bo)), "first password ok", r)
	if message, _ := w.service.RequestReset(ctx, bo, r); message != "" {
		t.Fatal("same answer for every address")
	}
	w.service.sendResetLink(ctx, bo)
	token := tokenIn(w.mail.last(t, bo))
	if outcome, _, _ := w.service.ResetWithToken(ctx, token, "second password ok", r); outcome != "password-changed" {
		t.Fatal("reset")
	}
	if _, message, _ := w.service.ResetWithToken(ctx, token, "third password ok", r); message != linkNotValid {
		t.Fatal("a link works once")
	}
	var sessions int
	w.service.Pool.QueryRow(ctx, `SELECT count(*) FROM sessions JOIN users ON users.id = sessions.user_id WHERE users.email = $1`, bo).Scan(&sessions)
	if sessions != 0 {
		t.Fatal("every login ended")
	}
	if answer, _ := w.service.LogIn(ctx, bo, "second password ok", r); len(answer.Cookies) != 2 {
		t.Fatalf("the new password works: %+v", answer)
	}
}

func TestAnInvitedTypoIsRemovedByItsResetLink(t *testing.T) {
	w := newAccountsWorld(t)
	ctx := context.Background()
	r := Request{IP: w.ip}
	owner := address()
	w.service.SignUp(ctx, NewPerson{Name: "Owner", Email: owner, Password: "owner password ok"}, r)
	w.service.ConfirmEmail(ctx, tokenIn(w.mail.last(t, owner)), "owner password ok", r)
	var ownerID, companyText string
	w.service.Pool.QueryRow(ctx, `SELECT id, company_id FROM users WHERE email = $1`, owner).Scan(&ownerID, &companyText)
	company, _ := tenant.FromTrustedSource(companyText)
	typo := address()
	inviteToken, _, _ := teammates.CreateInvite(ctx, w.service.Pool, company, ownerID, typo, "member", time.Now())
	if message, _ := w.service.JoinWithInvite(ctx, inviteToken, NewPerson{Name: "T", Email: address(), Password: "member password ok"}, r); message != inviteNotUsable {
		t.Fatal("an invite works only for its own address")
	}
	if message, err := w.service.JoinWithInvite(ctx, inviteToken, NewPerson{Name: "T", Email: typo, Password: "member password ok"}, r); message != "" || err != nil {
		t.Fatalf("join: %q %v", message, err)
	}
	var joined string
	w.service.Pool.QueryRow(ctx, `SELECT company_id FROM users WHERE email = $1`, typo).Scan(&joined)
	if joined != companyText {
		t.Fatal("the invite decides the company")
	}
	w.service.sendResetLink(ctx, typo)
	if outcome, _, err := w.service.ResetWithToken(ctx, tokenIn(w.mail.last(t, typo)), "anything long enough", r); outcome != "account-removed" || err != nil {
		t.Fatalf("the inbox owner takes the address back: %s %v", outcome, err)
	}
	var left int
	w.service.Pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE email = $1`, typo).Scan(&left)
	if left != 0 {
		t.Fatal("removed")
	}
	if _, field, _ := w.service.ChangePassword(ctx, company, ownerID, "not mine at all", "new owner password", r); field != "That is not your current password." {
		t.Fatal("the current password first")
	}
	answer, _, err := w.service.ChangePassword(ctx, company, ownerID, "owner password ok", "new owner password", r)
	details, _ := w.service.ReadDetails(ctx, company, ownerID)
	if err != nil || len(answer.Cookies) != 1 || details.ActiveSessions != 1 {
		t.Fatalf("changed: this browser keeps a fresh login, the others end: %+v %d", answer, details.ActiveSessions)
	}
}
