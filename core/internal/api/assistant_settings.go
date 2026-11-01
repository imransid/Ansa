package api

import (
	"net/http"
	"regexp"
	"strings"
	"time"

	"ansa/core/internal/assistant"
	"ansa/core/internal/home"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
	"ansa/core/internal/settings"
	"ansa/core/internal/setup"
)

// "Try your assistant": 20 tries per 10 minutes per person (each is a paid AI call).
var assistantTries = ratelimit.Rule{MaxAttempts: 20, Window: 10 * time.Minute}

// An Anthropic API key's shape: checked before anything is stored.
var anthropicKeyPattern = regexp.MustCompile(`^sk-ant-[A-Za-z0-9_-]{20,300}$`)

func (s *Server) registerAssistantSettings(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/settings/assistant", s.withSession(s.assistantSettings))
	routes.HandleFunc("POST /api/v1/settings/assistant", s.withSession(s.ownersOnly("Only owners can change the assistant.", s.saveAssistantSettings)))
	routes.HandleFunc("POST /api/v1/settings/assistant/engine", s.withSession(s.ownersOnly("Only owners can change the AI engine.", s.saveEngine)))
	routes.HandleFunc("POST /api/v1/settings/assistant/away", s.withSession(s.ownersOnly("Only owners say when ansa answers.", s.saveAway)))
	routes.HandleFunc("POST /api/v1/assistant/try", s.withSession(s.tryAssistant))
}

// assistantSettings: GET, everyone reads it; the engine's state says whose
// key answers (the business's: its last four; ansa's; or none), never a key.
func (s *Server) assistantSettings(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	view, err := settings.Read(r.Context(), s.Pool, who.CompanyID)
	if err != nil {
		s.failed(w, "assistant settings", err)
		return
	}
	var brain home.BrainStatus
	if s.Brain != nil {
		_ = s.Brain.Call(r.Context(), "/v1/status", map[string]string{}, &brain)
	}
	keySource := "none"
	switch {
	case view.KeyHint != "":
		keySource = "restaurant"
	case brain.AnsaKey:
		keySource = "ansa"
	}
	ready := keySource != "none"
	if view.Engine == "claude_code" {
		ready = brain.ClaudeCode
	}
	writeJSON(w, http.StatusOK, map[string]any{"settings": view, "canManage": who.IsOwner(),
		"engineState": map[string]any{"keySource": keySource, "claudeCodeAllowed": brain.ClaudeCode, "ready": ready}})
}

// ownersOnly refuses members with the given words, and counts the
// person's settings changes (60 per 10 minutes).
func (s *Server) ownersOnly(refusal string, h handler) handler {
	return func(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
		if !who.IsOwner() {
			problem(w, http.StatusForbidden, refusal)
			return
		}
		if over, err := s.Limiter.Over(r.Context(), "settings-changes", who.UserID, settingsChanges); err != nil || over {
			problem(w, http.StatusTooManyRequests, "Too many changes. Try again in a few minutes.")
			return
		}
		h(w, r, body, who)
	}
}

// saveAssistantSettings: {status, replyMode, instructions, holdingReply, alertByEmail}.
func (s *Server) saveAssistantSettings(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Status       string `json:"status"`
		ReplyMode    string `json:"replyMode"`
		Instructions string `json:"instructions"`
		HoldingReply string `json:"holdingReply"`
		AlertByEmail bool   `json:"alertByEmail"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	fields := map[string]string{}
	if input.Status != "on" && input.Status != "paused" {
		fields["status"] = "Choose whether the assistant is on."
	}
	if input.ReplyMode != "automatic" && input.ReplyMode != "ask_first" {
		fields["replyMode"] = "Choose how the assistant replies."
	}
	instructions, problemText := plaintext.Note(input.Instructions, 2000)
	if problemText != "" {
		fields["instructions"] = problemText
	}
	holding, problemText := plaintext.Note(input.HoldingReply, 500)
	if problemText == "" && holding == "" {
		problemText = "Write what people get while you take over."
	}
	if problemText != "" {
		fields["holdingReply"] = problemText
	}
	if len(fields) > 0 {
		fieldProblems(w, fields)
		return
	}
	outcome, err := settings.SaveAssistant(r.Context(), s.Pool, who.CompanyID, who.UserID, settings.Assistant{
		Status: input.Status, ReplyMode: input.ReplyMode, Instructions: instructions, HoldingReply: holding, AlertByEmail: input.AlertByEmail})
	s.answerSaved(w, outcome, err, "Only owners can change the assistant.")
}

// saveEngine: {engine, apiKey, removeKey}. A new key is stored encrypted for
// the company; only its last four characters are ever shown back.
func (s *Server) saveEngine(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Engine    string `json:"engine"`
		APIKey    string `json:"apiKey"`
		RemoveKey bool   `json:"removeKey"`
	}
	if !readJSON(body, &input) || (input.Engine != "api_key" && input.Engine != "claude_code") {
		fieldProblems(w, map[string]string{"engine": "Pick an AI engine."})
		return
	}
	key := strings.TrimSpace(input.APIKey)
	if key != "" && !anthropicKeyPattern.MatchString(key) {
		fieldProblems(w, map[string]string{"apiKey": "That doesn't look like a Claude API key (it starts with sk-ant-)."})
		return
	}
	var brain home.BrainStatus
	if input.Engine == "claude_code" && s.Brain != nil {
		_ = s.Brain.Call(r.Context(), "/v1/status", map[string]string{}, &brain)
	}
	if input.Engine == "claude_code" && !brain.ClaudeCode {
		problem(w, http.StatusBadRequest, "Claude Code can only be used while developing ansa. Use a Claude API key.")
		return
	}
	change := settings.KeyChange{Remove: input.RemoveKey}
	if key != "" {
		encrypted, err := s.Box.Encrypt(key, assistant.KeyContext(who.CompanyID))
		if err != nil {
			s.failed(w, "engine key", err)
			return
		}
		change = settings.KeyChange{Encrypted: encrypted, Hint: key[len(key)-4:]}
	}
	outcome, err := settings.SaveEngine(r.Context(), s.Pool, who.CompanyID, who.UserID, input.Engine, change)
	s.answerSaved(w, outcome, err, "Only owners can change the AI engine.")
}

// saveAway: {timeZone, hours: {mon: [{opens, closes}], ...}, replyGraceMinutes: 5|10|15|30|60|null}.
func (s *Server) saveAway(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var week setup.Week
	if !readJSON(body, &week) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	typed, fields := week.Check(true)
	if len(fields) > 0 {
		fieldProblems(w, fields)
		return
	}
	outcome, err := setup.SaveAway(r.Context(), s.Pool, who.CompanyID, who.UserID, week.TimeZone, typed, week.ReplyGraceMinutes, 0)
	s.answerSaved(w, outcome, err, "Only owners say when ansa answers.")
}

// tryAssistant: POST /api/v1/assistant/try {"text"}, owners only.
func (s *Server) tryAssistant(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	if !who.IsOwner() {
		problem(w, http.StatusForbidden, "Only owners can test the assistant.")
		return
	}
	var input struct {
		Text string `json:"text"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	text, problemText := plaintext.Note(input.Text, 4000)
	if problemText == "" && text == "" {
		problemText = "Write a customer's message first."
	}
	if problemText != "" {
		fieldProblems(w, map[string]string{"text": problemText})
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "assistant-tests", who.UserID, assistantTries); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many tests. Try again in a few minutes.")
		return
	}
	result, err := s.Assistant.Try(r.Context(), who.CompanyID, text)
	if err != nil {
		s.failed(w, "assistant try", err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// answerSaved answers a settings write.
func (s *Server) answerSaved(w http.ResponseWriter, outcome string, err error, refusal string) {
	switch {
	case err != nil:
		s.failed(w, "settings", err)
	case outcome != settings.Saved:
		problem(w, http.StatusForbidden, refusal)
	default:
		writeJSON(w, http.StatusOK, map[string]string{})
	}
}

// fieldProblems answers 400 with what is wrong with each field.
func fieldProblems(w http.ResponseWriter, fields map[string]string) {
	writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Check the highlighted fields.", "fields": fields})
}
