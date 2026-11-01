package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
	"ansa/core/internal/social"
	"ansa/core/internal/socialconnect"
)

// Connecting and disconnecting accounts: 30 per 10 minutes per person,
// every start and return counted.
var socialAccountChanges = ratelimit.Rule{MaxAttempts: 30, Window: 10 * time.Minute}

// Where every return from a platform lands, with its result code.
const accountsPage = "/cofounder/accounts"

func (s *Server) registerSocial(routes *http.ServeMux) {
	routes.HandleFunc("POST /api/v1/social/{platform}/connect", s.withSession(s.knownPlatform(s.socialOwners(s.startConnecting))))
	routes.HandleFunc("POST /api/v1/social/{platform}/stand-in", s.withSession(s.knownPlatform(s.socialOwners(s.connectStandIn))))
	routes.HandleFunc("GET /api/v1/social/{platform}/callback", s.withSession(s.knownPlatform(s.socialCallback)))
	routes.HandleFunc("POST /api/v1/social/connections/{id}/disconnect", s.withSession(s.socialOwners(s.disconnectAccount)))
	routes.HandleFunc("GET /api/v1/cofounder/accounts", s.withSession(s.socialAccountsPage))
}

// knownPlatform answers 404 for a platform ansa doesn't connect.
func (s *Server) knownPlatform(h handler) handler {
	return func(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
		if !socialconnect.IsPlatform(r.PathValue("platform")) {
			problem(w, http.StatusNotFound, "ansa doesn't connect that platform.")
			return
		}
		h(w, r, body, who)
	}
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

// startConnecting: {"url"} of the platform's consent screen to send the owner to.
func (s *Server) startConnecting(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	platform := r.PathValue("platform")
	label := contentrules.PlatformLabels[platform]
	address, outcome, err := s.Social.Start(r.Context(), who.CompanyID, who.UserID, platform)
	switch {
	case err != nil:
		s.failed(w, "social connect", err)
	case outcome == "not-set-up" && s.Social.Mode(platform) == "stand-in":
		problem(w, http.StatusConflict, label+" isn't set up on this development server: connect a stand-in account instead.")
	case outcome == "not-set-up":
		problem(w, http.StatusConflict, label+" isn't set up by ansa yet.")
	case outcome != "started":
		problem(w, http.StatusForbidden, "Only owners can connect or disconnect accounts.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"url": address})
	}
}

// connectStandIn connects the platform's development stand-in account.
func (s *Server) connectStandIn(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	outcome, err := s.Social.ConnectStandIn(r.Context(), who.CompanyID, who.UserID, r.PathValue("platform"))
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

// socialCallback: the owner's return from a platform, forwarded with its
// query by the screens. Always {"location"}: the Accounts page with a
// result code (and how many accounts), never a token, the code or the state.
func (s *Server) socialCallback(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	// Several platform requests in a row (up to 15 s each), as the old route's 90 s.
	allowLongAnswer(w, 90*time.Second)
	platform := r.PathValue("platform")
	result, count := "rate_limited", 0
	over, err := s.Limiter.Over(r.Context(), "social-accounts", who.UserID, socialAccountChanges)
	if err == nil && !over {
		result, count, err = s.Social.Complete(r.Context(), who.CompanyID, who.UserID, who.IsOwner(), platform, r.URL.Query())
	}
	if err != nil {
		s.Log.Error("api: social callback failed", logging.ErrorType(err))
		result, count = "exchange_failed", 0
	}
	location := accountsPage + "?result=" + result + "&platform=" + platform
	if count > 1 {
		location += "&count=" + strconv.Itoa(count)
	}
	writeJSON(w, http.StatusOK, map[string]string{"location": location})
}

// disconnectAccount disconnects one of the company's accounts; after the
// answer, X and Google are asked to take back what it removed.
func (s *Server) disconnectAccount(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("id"))
	if !uuidPattern.MatchString(id) {
		problem(w, http.StatusNotFound, "That account was not found in your company.")
		return
	}
	outcome, removed, err := socialconnect.Disconnect(r.Context(), s.Pool, who.CompanyID, who.UserID, id)
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
	if removed != nil && s.Social.Platforms != nil && !removed.IsStandIn && contentrules.RevokesOnRequest[removed.Platform] {
		go social.RevokeRemoved(context.WithoutCancel(r.Context()), s.Pool, s.Box, s.Social.Platforms, s.Log, who.CompanyID, *removed)
	}
}

// socialAccountsPage: GET /api/v1/cofounder/accounts, everyone reads it.
func (s *Server) socialAccountsPage(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	page, err := s.Social.AccountsPage(r.Context(), who.CompanyID, who.IsOwner())
	if err != nil {
		s.failed(w, "social accounts", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"page": page})
}
