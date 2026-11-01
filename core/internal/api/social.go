package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
	"ansa/core/internal/socialconnect"
)

// Connecting and disconnecting accounts: 30 per 10 minutes per person,
// every start and return counted.
var socialAccountChanges = ratelimit.Rule{MaxAttempts: 30, Window: 10 * time.Minute}

// Where every return from Facebook lands, with its result code.
const accountsPage = "/cofounder/accounts"

func (s *Server) registerSocial(routes *http.ServeMux) {
	routes.HandleFunc("POST /api/v1/social/facebook/connect", s.withSession(s.socialOwners(s.startFacebook)))
	routes.HandleFunc("POST /api/v1/social/facebook/stand-in", s.withSession(s.socialOwners(s.connectFacebookStandIn)))
	routes.HandleFunc("GET /api/v1/social/facebook/callback", s.withSession(s.facebookCallback))
	routes.HandleFunc("POST /api/v1/social/connections/{id}/disconnect", s.withSession(s.socialOwners(s.disconnectAccount)))
}

// socialOwners refuses members and counts the person's attempt.
func (s *Server) socialOwners(h handler) handler {
	return func(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
		if !who.IsOwner() {
			problem(w, http.StatusForbidden, "Only owners can connect or disconnect accounts.")
			return
		}
		if over, err := s.Limiter.Over(r.Context(), "social-accounts", who.UserID, socialAccountChanges); err != nil || over {
			problem(w, http.StatusTooManyRequests, "Too many attempts. Try again in a few minutes.")
			return
		}
		h(w, r, body, who)
	}
}

// startFacebook: {"url"} of Facebook's consent screen to send the owner to.
func (s *Server) startFacebook(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	address, outcome, err := s.Social.Start(r.Context(), who.CompanyID, who.UserID)
	switch {
	case err != nil:
		s.failed(w, "social connect", err)
	case outcome == "not-set-up" && s.Social.Mode() == "stand-in":
		problem(w, http.StatusConflict, "Facebook isn't set up on this development server: connect a stand-in account instead.")
	case outcome == "not-set-up":
		problem(w, http.StatusConflict, "Facebook isn't set up by ansa yet.")
	case outcome != "started":
		problem(w, http.StatusForbidden, "Only owners can connect or disconnect accounts.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"url": address})
	}
}

// connectFacebookStandIn connects the development stand-in Page.
func (s *Server) connectFacebookStandIn(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	outcome, err := s.Social.ConnectStandIn(r.Context(), who.CompanyID, who.UserID)
	switch {
	case err != nil:
		s.failed(w, "social stand-in", err)
	case outcome == "not-set-up":
		problem(w, http.StatusConflict, "A stand-in account can only be connected on a development server without the platform's app.")
	case outcome != "connected":
		problem(w, http.StatusForbidden, "Only owners can connect or disconnect accounts.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "connected"})
	}
}

// facebookCallback: the owner's return from Facebook, forwarded with its
// query by the screens. Always {"location"}: the Accounts page with a
// result code (and how many Pages), never a token, the code or the state.
func (s *Server) facebookCallback(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	// Several Graph requests in a row (up to 15 s each), as the old route's 90 s.
	allowLongAnswer(w, 90*time.Second)
	result, count := "rate_limited", 0
	over, err := s.Limiter.Over(r.Context(), "social-accounts", who.UserID, socialAccountChanges)
	if err == nil && !over {
		result, count, err = s.Social.Complete(r.Context(), who.CompanyID, who.UserID, who.IsOwner(), r.URL.Query())
	}
	if err != nil {
		s.Log.Error("api: social callback failed", logging.ErrorType(err))
		result, count = "exchange_failed", 0
	}
	location := accountsPage + "?result=" + result + "&platform=facebook"
	if count > 1 {
		location += "&count=" + strconv.Itoa(count)
	}
	writeJSON(w, http.StatusOK, map[string]string{"location": location})
}

// disconnectAccount disconnects one of the company's Facebook Pages.
func (s *Server) disconnectAccount(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("id"))
	if !uuidPattern.MatchString(id) {
		problem(w, http.StatusNotFound, "That account was not found in your company.")
		return
	}
	outcome, err := socialconnect.Disconnect(r.Context(), s.Pool, who.CompanyID, who.UserID, id)
	switch {
	case err != nil:
		s.failed(w, "social disconnect", err)
	case outcome == "not-found":
		problem(w, http.StatusNotFound, "That account was not found in your company.")
	case outcome == "not-allowed":
		problem(w, http.StatusForbidden, "Only owners can connect or disconnect accounts.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": outcome})
	}
}
