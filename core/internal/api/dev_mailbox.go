package api

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"ansa/core/internal/devmail"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
)

// The development mailbox (for trying and showing ansa on the laptop,
// core/internal/devmail): the emails ansa "sent" here. Owners read the ones
// sent for their company (its people, customers and alerts); a page with no login yet (after
// signing up, asking for a reset) shows the newest email to an address the
// visitor types. Refused when real email is on or in production: the API
// then has no folder (DevMailFolder "").

var devMailPeeks = ratelimit.Rule{MaxAttempts: 60, Window: 10 * time.Minute}

const devMailOnly = "The development mailbox is for trying ansa on this computer: real emails go to real inboxes."

const devMailMadeUpOnly = "Without a login, the development mailbox shows only emails to made-up addresses (like name@demo.ansa.test)."

// madeUpAddress: an address no real inbox can have (the demo's domain,
// reserved test and example names). The look needs no login, so an email to
// a real address (its reset link) is never shown this way, even here.
func madeUpAddress(address string) bool {
	domain := address[strings.LastIndex(address, "@")+1:]
	for _, reserved := range []string{".test", ".example", ".invalid", ".localhost"} {
		if strings.HasSuffix(domain, reserved) {
			return true
		}
	}
	switch domain {
	case "example.com", "example.net", "example.org":
		return true
	}
	return false
}

func (s *Server) registerDevMailbox(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/dev/mailbox", s.withSession(s.devMailbox))
	routes.HandleFunc("POST /api/v1/dev/mailbox/newest", s.withScreens(s.newestDevMail))
}

// devMailbox: GET: {available, emails: the newest 50 sent for the
// company} (owners).
func (s *Server) devMailbox(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	if s.DevMailFolder == "" || !who.IsOwner() {
		writeJSON(w, http.StatusOK, map[string]any{"available": false, "emails": []devmail.Mail{}})
		return
	}
	ofCompany, err := devmail.OfCompany(r.Context(), s.Pool, who.CompanyID)
	if err != nil {
		s.failed(w, "dev mailbox", err)
		return
	}
	emails, err := devmail.Read(s.DevMailFolder, ofCompany, 50)
	if err != nil {
		s.failed(w, "dev mailbox", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"available": true, "emails": emails})
}

// newestDevMail: POST {email, ...browser}: {email: the newest one to that
// address, or null}. No login: it is for the pages before one.
func (s *Server) newestDevMail(w http.ResponseWriter, r *http.Request, body []byte) {
	if s.DevMailFolder == "" {
		problem(w, http.StatusForbidden, devMailOnly)
		return
	}
	var input struct {
		Email string `json:"email"`
		browser
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	address := strings.ToLower(strings.TrimSpace(input.Email))
	if !strings.Contains(address, "@") || utf8.RuneCountInString(address) > 254 {
		fieldProblems(w, map[string]string{"email": "Write the email address you used."})
		return
	}
	if !madeUpAddress(address) {
		problem(w, http.StatusForbidden, devMailMadeUpOnly)
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "dev-mailbox", cutText(input.ClientIP, 100), devMailPeeks); err != nil || over {
		problem(w, http.StatusTooManyRequests, "That's a lot of looks. Try again in a few minutes.")
		return
	}
	emails, err := devmail.Read(s.DevMailFolder, devmail.ToAddress(address), 1)
	if err != nil {
		s.failed(w, "dev mailbox", err)
		return
	}
	var newest *devmail.Mail
	if len(emails) == 1 {
		newest = &emails[0]
	}
	writeJSON(w, http.StatusOK, map[string]any{"email": newest})
}
