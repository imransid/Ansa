package api

import (
	"net/http"
	"time"

	"ansa/core/internal/billing"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
)

// Billing actions: 20 per 10 minutes per owner.
var billingActions = ratelimit.Rule{MaxAttempts: 20, Window: 10 * time.Minute}

func (s *Server) registerBilling(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/billing", s.withSession(s.billingPage))
	routes.HandleFunc("POST /api/v1/billing/checkout", s.withSession(s.billingOwners(s.checkout)))
	routes.HandleFunc("POST /api/v1/billing/portal", s.withSession(s.billingOwners(s.billingPortal)))
	routes.HandleFunc("POST /api/v1/billing/simulate", s.withSession(s.billingOwners(s.simulateBilling)))
}

// billingOwners refuses members and counts the owner's action.
func (s *Server) billingOwners(h handler) handler {
	return func(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
		if !who.IsOwner() {
			problem(w, http.StatusForbidden, "Only owners can manage billing.")
			return
		}
		if over, err := s.Limiter.Over(r.Context(), "billing", who.UserID, billingActions); err != nil || over {
			problem(w, http.StatusTooManyRequests, "Too many attempts. Try again in a few minutes.")
			return
		}
		h(w, r, body, who)
	}
}

// billingPage: GET ?checkout=done; owners only (members get null).
func (s *Server) billingPage(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	if !who.IsOwner() {
		writeJSON(w, http.StatusOK, map[string]any{"billing": nil})
		return
	}
	view, err := billing.ReadView(r.Context(), s.Pool, who.CompanyID, s.BillingMode, r.URL.Query().Get("checkout") == "done")
	if err != nil {
		s.failed(w, "billing", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"billing": view})
}

// checkout: {"url"} of Stripe's payment page, never while a plan is live.
func (s *Server) checkout(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	// Up to two Stripe requests (20 s each).
	allowLongAnswer(w, 60*time.Second)
	switch s.BillingMode {
	case "dev":
		problem(w, http.StatusConflict, "Payments are off (USE_STRIPE). Use the simulate buttons.")
		return
	case "off":
		problem(w, http.StatusConflict, "Billing isn't set up yet.")
		return
	}
	current, err := billing.Read(r.Context(), s.Pool, who.CompanyID)
	if err != nil {
		s.failed(w, "checkout", err)
		return
	}
	if current != nil && billing.IsLive(current.Status) {
		problem(w, http.StatusConflict, "You already have a subscription. Use Manage billing.")
		return
	}
	customer := ""
	if current != nil {
		customer = current.CustomerID
	}
	url, err := s.Stripe.CheckoutURL(r.Context(), who.CompanyID.String(), who.Email, customer, s.AppURL+"/billing?checkout=done", s.AppURL+"/billing")
	if err != nil {
		problem(w, http.StatusServiceUnavailable, "Stripe could not open the payment page right now. Try again in a few minutes.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": url})
}

// billingPortal: {"url"} of Stripe's page to change card, see invoices or cancel.
func (s *Server) billingPortal(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	// Up to two Stripe requests (20 s each).
	allowLongAnswer(w, 60*time.Second)
	current, err := billing.Read(r.Context(), s.Pool, who.CompanyID)
	if err != nil {
		s.failed(w, "portal", err)
		return
	}
	if s.BillingMode != "stripe" || current == nil {
		problem(w, http.StatusConflict, "There is no subscription to manage yet.")
		return
	}
	url, err := s.Stripe.PortalURL(r.Context(), current.CustomerID, s.AppURL+"/billing")
	if err != nil {
		problem(w, http.StatusServiceUnavailable, "Stripe could not open the billing page right now. Try again in a few minutes.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": url})
}

// simulateBilling: {status: active | past_due | canceled}, development only.
func (s *Server) simulateBilling(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Status string `json:"status"`
	}
	if s.BillingMode != "dev" {
		problem(w, http.StatusConflict, "Simulating payments is only possible in development.")
		return
	}
	if !readJSON(body, &input) || (input.Status != "active" && input.Status != "past_due" && input.Status != "canceled") {
		problem(w, http.StatusBadRequest, "Unknown status.")
		return
	}
	if err := billing.Simulate(r.Context(), s.Pool, who.CompanyID, input.Status, time.Now()); err != nil {
		s.failed(w, "simulate billing", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"outcome": "saved"})
}
