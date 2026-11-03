package api

import (
	"net/http"
	"time"
	"unicode/utf8"

	"ansa/core/internal/addresses"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/practicechat"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
)

// The practice email (development only, the practice chat's "Email"): an
// owner writes an email as a made-up customer, and it reaches the company's
// forwarding address as a forwarded email reaches it through Resend
// (core/internal/practicechat). Core's workers then read it as any received
// email: the filters, the AI's triage, the request and the conversation.

// As many as the AI reads for a company in an hour (inbound's triage limit).
var practiceEmails = ratelimit.Rule{MaxAttempts: 100, Window: time.Hour}

// The text (up to 100,000 characters, each up to 6 bytes written as JSON)
// and the fields around it.
const practiceEmailBodyBytes = 1 << 20

const practiceEmailNotWithRealEmail = "Real email is on here (SEND_REAL_EMAIL), so core would ask Resend for this email instead of reading the practice one. Switch it off to practice."

// practiceInbox is the folder core's development fetcher reads received
// emails from ("" while it asks Resend for them: real email is on).
func (s *Server) practiceInbox() string {
	if s.Inbound == nil || s.Inbound.Fetcher == nil || s.Inbound.Fetcher.Real {
		return ""
	}
	return s.Inbound.Fetcher.DevFolder
}

// sendPracticeEmail: POST {name, address, subject, text, verified}: {to},
// the forwarding address the email went to.
func (s *Server) sendPracticeEmail(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Name     string `json:"name"`
		Address  string `json:"address"`
		Subject  string `json:"subject"`
		Text     string `json:"text"`
		Verified bool   `json:"verified"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	email, fields := checkPracticeEmail(input.Name, input.Address, input.Subject, input.Text)
	if len(fields) > 0 {
		fieldProblems(w, fields)
		return
	}
	email.Verified = input.Verified
	inbox := s.practiceInbox()
	if inbox == "" {
		problem(w, http.StatusConflict, practiceEmailNotWithRealEmail)
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "practice-emails", who.CompanyID.String(), practiceEmails); err != nil || over {
		problem(w, http.StatusTooManyRequests, "That's a lot of practice emails this hour. Try again later.")
		return
	}
	to, err := practicechat.SendEmail(r.Context(), s.Pool, inbox, s.ForwardingDomain, who.CompanyID, email)
	if err != nil {
		s.failed(w, "practice email", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"to": to})
}

// checkPracticeEmail reads the fields as a received email keeps them: the
// sender's address by the customer address rule, a name (or none) and a
// subject of one plain line, and the text as a box of several lines.
func checkPracticeEmail(name, address, subject, text string) (practicechat.Email, map[string]string) {
	email := practicechat.Email{Name: plaintext.SingleLine(name), Subject: plaintext.SingleLine(subject)}
	fields := map[string]string{}
	if utf8.RuneCountInString(email.Name) > 100 {
		fields["name"] = "Write the sender's name in up to 100 characters."
	}
	var problemText string
	if email.Address, problemText = addresses.CustomerEmail(address); problemText != "" {
		fields["address"] = problemText
	}
	if email.Subject == "" || utf8.RuneCountInString(email.Subject) > 1000 {
		fields["subject"] = "Write a subject (up to 1,000 characters)."
	}
	email.Text, problemText = plaintext.Note(text, 100_000)
	if problemText == "" && email.Text == "" {
		problemText = "Write the email (up to 100,000 characters)."
	}
	if problemText != "" {
		fields["text"] = problemText
	}
	return email, fields
}
