package api

import (
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"ansa/core/internal/addresses"
	"ansa/core/internal/outbox"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
	"ansa/core/internal/tickets"
)

var retryRefusals = map[string]string{
	outbox.NotDeliverable:    "This email was already sent, is being sent right now, or can no longer be sent.",
	outbox.OverDailyLimit:    "Daily email limit reached. Use Retry later.",
	outbox.Failed:            "Sending failed again. Try later.",
	outbox.NeedsConfirmation: "This email may already have reached the customer: it was first tried more than 23 hours ago. Reload the page to confirm sending it again.",
}

func (s *Server) registerRequestEmails(routes *http.ServeMux) {
	routes.HandleFunc("POST /api/v1/requests/{id}/solve", s.withSession(s.requestChange(s.solveRequest)))
	routes.HandleFunc("POST /api/v1/requests/{id}/emails/{email}/retry", s.withSession(s.requestChange(s.retryEmail)))
	routes.HandleFunc("POST /api/v1/requests/{id}/customer-email", s.withSession(s.customerEmail))
	routes.HandleFunc("POST /api/v1/requests/{id}/details", s.withSession(s.requestChange(s.editRequest)))
	routes.HandleFunc("POST /api/v1/requests", s.withSession(s.newRequest))
}

// solveRequest: "Mark as solved" {"confirmedCustomerEmail": "" | the address the page showed}.
func (s *Server) solveRequest(r *http.Request, body []byte, who *session.Session, id string) (string, error) {
	var input struct {
		ConfirmedCustomerEmail string `json:"confirmedCustomerEmail"`
	}
	if !readJSON(body, &input) || len(input.ConfirmedCustomerEmail) > 320 {
		return requestGone, nil
	}
	solved, _, err := tickets.Solve(r.Context(), s.Pool, who.CompanyID, who.UserID, id, input.ConfirmedCustomerEmail)
	if !solved && err == nil {
		return "This request changed meanwhile (solved already, or its customer email changed). Reload the page.", nil
	}
	return "", err
}

// retryEmail: Retry {"confirmPossibleDuplicate": bool}, anyone in the company.
func (s *Server) retryEmail(r *http.Request, body []byte, who *session.Session, _ string) (string, error) {
	var input struct {
		ConfirmPossibleDuplicate bool `json:"confirmPossibleDuplicate"`
	}
	emailID := strings.ToLower(r.PathValue("email"))
	if !readJSON(body, &input) || !uuidPattern.MatchString(emailID) {
		return "Unknown email.", nil
	}
	outcome, err := s.Outbox.Deliver(r.Context(), who.CompanyID, emailID, input.ConfirmPossibleDuplicate)
	if outcome == outbox.Sent || err != nil {
		return "", err
	}
	return retryRefusals[outcome], nil
}

// customerEmail: {"email", "confirmed": false} answers the cleaned-up
// address to confirm ("Solved emails for this request will go to ..."); the
// same with "confirmed": true saves exactly it.
func (s *Server) customerEmail(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("id"))
	var input struct {
		Email     string `json:"email"`
		Confirmed bool   `json:"confirmed"`
	}
	if !uuidPattern.MatchString(id) || !readJSON(body, &input) {
		problem(w, http.StatusNotFound, requestGone)
		return
	}
	address, problemText := addresses.CustomerEmail(input.Email)
	if problemText != "" {
		fieldProblems(w, map[string]string{"email": problemText})
		return
	}
	if !input.Confirmed {
		writeJSON(w, http.StatusOK, map[string]string{"confirm": address})
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "ticket-changes", who.UserID, ticketChanges); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many changes. Try again in a few minutes.")
		return
	}
	set, err := tickets.SetCustomerEmail(r.Context(), s.Pool, who.CompanyID, who.UserID, id, address)
	switch {
	case err != nil:
		s.failed(w, "customer email", err)
	case !set:
		problem(w, http.StatusNotFound, requestGone)
	default:
		writeJSON(w, http.StatusOK, map[string]string{"saved": address})
	}
}

// editRequest: "Edit subject or customer name" with what the editor opened with.
func (s *Server) editRequest(r *http.Request, body []byte, who *session.Session, id string) (string, error) {
	var input tickets.Edit
	var typed struct {
		Subject              string `json:"subject"`
		OriginalSubject      string `json:"originalSubject"`
		CustomerName         string `json:"customerName"`
		OriginalCustomerName string `json:"originalCustomerName"`
	}
	if !readJSON(body, &typed) {
		return requestGone, nil
	}
	input = tickets.Edit{Subject: plaintext.SingleLine(typed.Subject), OriginalSubject: typed.OriginalSubject,
		CustomerName: plaintext.SingleLine(typed.CustomerName), OriginalCustomerName: typed.OriginalCustomerName}
	switch {
	case input.Subject == "":
		return "Subject is required", nil
	case utf8.RuneCountInString(input.Subject) > 200:
		return "A subject can be at most 200 characters.", nil
	case utf8.RuneCountInString(input.CustomerName) > 200:
		return "A name can be at most 200 characters.", nil
	}
	found, err := tickets.EditDetails(r.Context(), s.Pool, who.CompanyID, who.UserID, id, input)
	if !found && err == nil {
		return requestGone, nil
	}
	return "", err
}

// A person's new requests (and escalations): 30 per 10 minutes (the old counter).
var ticketCreations = ratelimit.Rule{MaxAttempts: 30, Window: 10 * time.Minute}

// newRequest: "New request" {subject, description, customerName,
// customerEmail, customerEmailConfirmed, customerPhone, categoryId}; a typed
// customer email needs its confirm step first. Answers {"number"}.
func (s *Server) newRequest(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Subject                string `json:"subject"`
		Description            string `json:"description"`
		CustomerName           string `json:"customerName"`
		CustomerEmail          string `json:"customerEmail"`
		CustomerEmailConfirmed bool   `json:"customerEmailConfirmed"`
		CustomerPhone          string `json:"customerPhone"`
		CategoryID             string `json:"categoryId"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	req, fields := checkNewRequest(input.Subject, input.Description, input.CustomerName, input.CustomerEmail, input.CustomerPhone, input.CategoryID)
	if req.CustomerEmail != "" && !input.CustomerEmailConfirmed && fields["customerEmail"] == "" {
		fields["customerEmail"] = "Confirm the address before saving"
	}
	if len(fields) > 0 {
		fieldProblems(w, fields)
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "ticket-creations", who.UserID, ticketCreations); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many new requests. Try again in a few minutes.")
		return
	}
	number, err := tickets.CreateManual(r.Context(), s.Pool, who.CompanyID, who.UserID, req)
	if err != nil {
		s.failed(w, "new request", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"number": number})
}

// checkNewRequest applies the request fields' one set of rules.
func checkNewRequest(subject, description, name, address, phone, categoryID string) (tickets.NewRequest, map[string]string) {
	fields := map[string]string{}
	req := tickets.NewRequest{Subject: plaintext.SingleLine(subject), CustomerName: plaintext.SingleLine(name), Phone: strings.TrimSpace(phone), CategoryID: strings.ToLower(categoryID)}
	switch {
	case req.Subject == "":
		fields["subject"] = "Subject is required"
	case utf8.RuneCountInString(req.Subject) > 200:
		fields["subject"] = "A subject can be at most 200 characters."
	}
	var problemText string
	if req.Description, problemText = plaintext.Note(description, 10_000); problemText != "" {
		fields["description"] = problemText
	} else if req.Description == "" {
		fields["description"] = "Description is required"
	}
	if utf8.RuneCountInString(req.CustomerName) > 200 {
		fields["customerName"] = "A name can be at most 200 characters."
	}
	if utf8.RuneCountInString(req.Phone) > 40 || strings.ContainsFunc(req.Phone, unicode.IsControl) {
		fields["customerPhone"] = "A phone number can be at most 40 characters."
	}
	if strings.TrimSpace(address) != "" {
		if req.CustomerEmail, problemText = addresses.CustomerEmail(address); problemText != "" {
			fields["customerEmail"] = problemText
		}
	}
	if req.CategoryID != "" && !uuidPattern.MatchString(req.CategoryID) {
		req.CategoryID = ""
	}
	return req, fields
}
