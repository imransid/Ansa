package api

import (
	"net/http"
	"regexp"
	"strings"
	"time"

	"ansa/core/internal/logging"
	"ansa/core/internal/orders"
	"ansa/core/internal/packages"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
)

// A person's changes in the Inbox and on the Orders page: 120 per 10 minutes
// (the old RATE_LIMITS.inboxChangesPerUser, the same counter).
var inboxChanges = ratelimit.Rule{MaxAttempts: 120, Window: 10 * time.Minute}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// listOrders: GET /api/v1/orders, everyone in the company. With it, whether
// the package includes orders (step 57): without, the assistant hands every
// order to a person, and the page says so.
func (s *Server) listOrders(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	open, finished, err := orders.ListForPage(r.Context(), s.Pool, s.Box, who.CompanyID)
	if err != nil {
		s.Log.Error("api: orders list failed", logging.ErrorType(err))
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	pkg, err := packages.Of(r.Context(), s.Pool, who.CompanyID, time.Now())
	if err != nil {
		s.Log.Error("api: orders package failed", logging.ErrorType(err))
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"open": nonNil(open), "finished": nonNil(finished), "packageIncludesOrders": pkg.Orders})
}

// changeOrderStatus: POST /api/v1/orders/{id}/status {"change": "accept" |
// "ready" | "done" | "cancel"}. Answers {"notTold", "number", "channel"}:
// notTold is "" when the customer was told, else why not (a chat's refusal
// or "send-failed"), which the Orders page words for the order's channel.
func (s *Server) changeOrderStatus(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Change string `json:"change"`
	}
	orderID := strings.ToLower(r.PathValue("id"))
	if !readJSON(body, &input) || !orders.IsChange(input.Change) || !uuidPattern.MatchString(orderID) {
		problem(w, http.StatusNotFound, "This order isn't there any more. Reload the page.")
		return
	}
	over, err := s.Limiter.Over(r.Context(), "inbox-changes", who.UserID, inboxChanges)
	if err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many changes. Try again in a few minutes.")
		return
	}
	result, err := s.Orders.Change(r.Context(), who.CompanyID, who.UserID, orderID, input.Change)
	if err != nil {
		s.Log.Error("api: order change failed", logging.ErrorType(err))
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	switch result.Outcome {
	case orders.ChangeNotFound:
		problem(w, http.StatusNotFound, "This order isn't there any more. Reload the page.")
	case orders.ChangeNotAllowed:
		problem(w, http.StatusForbidden, "You can no longer work this company's orders.")
	case orders.ChangeMeanwhile:
		problem(w, http.StatusConflict, "Someone changed this order meanwhile. Reload the page.")
	default:
		writeJSON(w, http.StatusOK, map[string]any{"notTold": result.NotToldWhy, "number": result.Number, "channel": result.Channel})
	}
}

// nonNil: an empty list is [] in JSON, never null.
func nonNil(list []orders.PageOrder) []orders.PageOrder {
	if list == nil {
		return []orders.PageOrder{}
	}
	return list
}
