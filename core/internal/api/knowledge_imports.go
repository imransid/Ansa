package api

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"ansa/core/internal/knowledge"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
)

// "Test what the AI finds": 30 a minute per person. Imports: 20 an hour per
// company (each reads a whole file or page).
var (
	knowledgeTests   = ratelimit.Rule{MaxAttempts: 30, Window: time.Minute}
	knowledgeImports = ratelimit.Rule{MaxAttempts: 20, Window: time.Hour}
)

// testKnowledge: {question} → exactly what the assistant would read for it.
func (s *Server) testKnowledge(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Question string `json:"question"`
	}
	if !readJSON(body, &input) || strings.TrimSpace(input.Question) == "" || utf8.RuneCountInString(input.Question) > 500 {
		fieldProblems(w, map[string]string{"question": "Type a question of at most 500 characters."})
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "knowledge-test-searches", who.UserID, knowledgeTests); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many searches. Try again in a minute.")
		return
	}
	hits, err := knowledge.Search(r.Context(), s.Pool, who.CompanyID, input.Question, "support", 3)
	if err != nil {
		s.failed(w, "knowledge test", err)
		return
	}
	// Exactly what the chat assistant reads (its 3 pieces within 3,000
	// characters), and the one line the phone assistant hears.
	kept, text := knowledge.Slice(hits, 3_000)
	if kept == nil {
		kept = []knowledge.Hit{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"slice": map[string]any{"hits": kept, "text": text}, "callAnswer": knowledge.BuildCallAnswer(hits).Text})
}

// importAllowed: owners only, within the company's hourly imports.
func (s *Server) importAllowed(w http.ResponseWriter, r *http.Request, who *session.Session) bool {
	if !who.IsOwner() {
		problem(w, http.StatusForbidden, "Only owners can import into knowledge.")
		return false
	}
	if over, err := s.Limiter.Over(r.Context(), "knowledge-imports", who.CompanyID.String(), knowledgeImports); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Your company has imported a lot in the last hour. Try again later.")
		return false
	}
	return true
}

// importDocument: {documentId} → draft articles from a stored document.
func (s *Server) importDocument(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		DocumentID string `json:"documentId"`
	}
	if !readJSON(body, &input) || !uuidPattern.MatchString(input.DocumentID) {
		problem(w, http.StatusBadRequest, "Unknown document.")
		return
	}
	if !s.importAllowed(w, r, who) {
		return
	}
	allowLongAnswer(w, 120*time.Second)
	created, wasCut, why, err := knowledge.ImportDocument(r.Context(), s.Pool, s.Files, s.MenuBrain, s.Log, who.CompanyID, who.UserID, strings.ToLower(input.DocumentID))
	s.importOutcome(w, created, wasCut, why, err)
}

// importWebPage: {url} → draft articles from one public web page.
func (s *Server) importWebPage(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		URL string `json:"url"`
	}
	if !readJSON(body, &input) || strings.TrimSpace(input.URL) == "" || len(input.URL) > 2_000 {
		fieldProblems(w, map[string]string{"url": "Type the page's address (https://...)."})
		return
	}
	if !s.importAllowed(w, r, who) {
		return
	}
	address := strings.TrimSpace(input.URL)
	created, wasCut, code, why, err := knowledge.ImportWebPage(r.Context(), s.Pool, s.WebFetcher, who.CompanyID, who.UserID, address)
	if code != "" {
		// The code only, never the address.
		s.Log.Warn("api: knowledge web import failed", logging.Code(code))
		fieldProblems(w, map[string]string{"url": knowledge.FetchProblems[code]})
		return
	}
	s.importOutcome(w, created, wasCut, why, err)
}

func (s *Server) importOutcome(w http.ResponseWriter, created int, wasCut bool, why string, err error) {
	switch {
	case err != nil:
		s.failed(w, "knowledge import", err)
	case why != "":
		problem(w, http.StatusUnprocessableEntity, why)
	default:
		writeJSON(w, http.StatusOK, map[string]any{"created": created, "wasCut": wasCut})
	}
}
