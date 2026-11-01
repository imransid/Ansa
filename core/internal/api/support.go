package api

import (
	"net/http"
	"strings"
	"time"

	"ansa/core/internal/addresses"
	"ansa/core/internal/channels"
	"ansa/core/internal/documents"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
	"ansa/core/internal/supportsetup"
)

// Uploads: 20 per 10 minutes per person; downloads 200 (each a signed link).
var (
	documentUploads   = ratelimit.Rule{MaxAttempts: 20, Window: 10 * time.Minute}
	documentDownloads = ratelimit.Rule{MaxAttempts: 200, Window: 10 * time.Minute}
)

func (s *Server) registerSupport(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/settings/support", s.withSession(s.supportPage))
	routes.HandleFunc("POST /api/v1/settings/support/reply-to", s.withSession(s.ownersOnly("Only owners can change this.", s.saveReplyTo)))
	routes.HandleFunc("POST /api/v1/settings/support/addresses", s.withSession(s.ownersOnly("Only owners can change this.", s.addSupportAddress)))
	routes.HandleFunc("POST /api/v1/settings/support/addresses/remove", s.withSession(s.ownersOnly("Only owners can change this.", s.removeSupportAddress)))
	routes.HandleFunc("POST /api/v1/documents", s.withSessionUpTo(menuReadBodyBytes, s.uploadDocument))
	routes.HandleFunc("GET /api/v1/documents/{id}/download", s.withSession(s.downloadDocument))
	routes.HandleFunc("POST /api/v1/documents/{id}/delete", s.withSession(s.ownersOnly("Only owners can delete documents.", s.deleteDocument)))
}

// supportPage: GET, everyone reads it: the reply-to and support addresses,
// the forwarding address and last email, the phone lines, the documents and
// what the checklist counts.
func (s *Server) supportPage(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	overview, err := supportsetup.Read(r.Context(), s.Pool, who.CompanyID)
	if err != nil {
		s.failed(w, "support page", err)
		return
	}
	connections, err := channels.Read(r.Context(), s.Pool, who.CompanyID, s.ForwardingDomain)
	if err != nil {
		s.failed(w, "support page", err)
		return
	}
	list, err := documents.List(r.Context(), s.Pool, who.CompanyID)
	if err != nil {
		s.failed(w, "support page", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"overview": overview, "forwardingAddress": connections.ForwardingAddress, "lastEmailAt": connections.LastEmailAt,
		"phoneLines": connections.PhoneLines, "documents": list, "canManage": who.IsOwner()})
}

// customerAddress reads {field: address}: the customer address rule, never
// one of ansa's own.
func (s *Server) customerAddress(w http.ResponseWriter, body []byte, field string, allowEmpty bool, ansaWords string) (string, bool) {
	var input map[string]string
	if !readJSON(body, &input) || len(input) != 1 {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return "", false
	}
	text, present := input[field]
	if !present {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return "", false
	}
	if allowEmpty && strings.TrimSpace(text) == "" {
		return "", true
	}
	address, why := addresses.CustomerEmail(text)
	if why == "" && supportsetup.IsAnsaAddress(address, s.EmailFrom, s.ForwardingDomain) {
		why = ansaWords
	}
	if why != "" {
		fieldProblems(w, map[string]string{field: why})
		return "", false
	}
	return address, true
}

// saveReplyTo: {replyToEmail} ("" clears it: replies go to the forwarding address).
func (s *Server) saveReplyTo(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	address, ok := s.customerAddress(w, body, "replyToEmail", true, "That is one of ansa's addresses. Leave this empty and replies go to your forwarding address.")
	if !ok {
		return
	}
	if err := supportsetup.SetReplyTo(r.Context(), s.Pool, who.CompanyID, address); err != nil {
		s.failed(w, "reply-to", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"outcome": "saved"})
}

// addSupportAddress: {address}.
func (s *Server) addSupportAddress(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	address, ok := s.customerAddress(w, body, "address", false, "That is one of ansa's addresses. Add the address your customers write to, like support@yourcompany.com.")
	if !ok {
		return
	}
	added, err := supportsetup.AddSupportAddress(r.Context(), s.Pool, who.CompanyID, address)
	switch {
	case err != nil:
		s.failed(w, "support address", err)
	case !added:
		fieldProblems(w, map[string]string{"address": "You already added that address."})
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "added"})
	}
}

// removeSupportAddress: {address}.
func (s *Server) removeSupportAddress(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Address string `json:"address"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Unknown address.")
		return
	}
	removed, err := supportsetup.RemoveSupportAddress(r.Context(), s.Pool, who.CompanyID, addresses.Normalize(input.Address))
	switch {
	case err != nil:
		s.failed(w, "support address", err)
	case !removed:
		problem(w, http.StatusNotFound, "Unknown address.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "removed"})
	}
}
