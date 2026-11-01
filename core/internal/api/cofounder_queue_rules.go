package api

import (
	"net/http"
	"strings"
	"unicode/utf8"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/publishing"
	"ansa/core/internal/session"
)

// The longest content pillar a rule names (as a draft's pillar).
const rulePillarMax = 200

// createAutopublishRule: POST {platform, pillar}: a rule (owners), made
// switched OFF, for one platform and a pillar of the current marketing
// plan by name ("" = any pillar). Answers {"outcome": "created", "ruleId"}.
func (s *Server) createAutopublishRule(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Platform string `json:"platform"`
		Pillar   string `json:"pillar"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page and try again.")
		return
	}
	pillar := contentrules.CleanDraftLine(input.Pillar)
	fields := map[string]string{}
	if !contentrules.Takes(contentrules.Platforms, input.Platform) {
		fields["platform"] = "Pick a platform."
	}
	if utf8.RuneCountInString(pillar) > rulePillarMax {
		fields["pillar"] = "A pillar can be at most 200 characters."
	}
	if len(fields) > 0 {
		fieldProblems(w, fields)
		return
	}
	if !who.IsOwner() {
		problem(w, http.StatusForbidden, onlyOwnersPublish)
		return
	}
	pillars, err := publishing.CurrentPlanPillars(r.Context(), s.Pool, who.CompanyID)
	if err != nil {
		s.failed(w, "autopublish rule", err)
		return
	}
	planPillar := publishing.PlanPillarNamed(pillars, pillar)
	if pillar != "" && planPillar == "" {
		fieldProblems(w, map[string]string{"pillar": "Pick a content pillar of the current marketing plan, or any pillar."})
		return
	}
	if !s.withinPublishingChanges(w, r, who) {
		return
	}
	outcome, ruleID, err := publishing.CreateRule(r.Context(), s.Pool, who.CompanyID, who.UserID, input.Platform, planPillar)
	switch {
	case err != nil:
		s.failed(w, "autopublish rule", err)
	case outcome == "not-allowed":
		problem(w, http.StatusForbidden, onlyOwnersPublish)
	case outcome == "exists":
		problem(w, http.StatusConflict, "There is a rule for that platform and pillar already.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "created", "ruleId": ruleID})
	}
}

// switchAutopublishRule: POST {enabled}: switches one rule on (the page
// asked the owner first: posts go out WITHOUT anyone approving each one)
// or off. Owners only. Answers {"outcome": "changed" | "unchanged"}.
func (s *Server) switchAutopublishRule(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	ruleID := strings.ToLower(r.PathValue("id"))
	var input struct {
		Enabled *bool `json:"enabled"`
	}
	if !uuidPattern.MatchString(ruleID) || !readJSON(body, &input) || input.Enabled == nil {
		problem(w, http.StatusBadRequest, "Unknown rule. Reload the page and try again.")
		return
	}
	if !who.IsOwner() {
		problem(w, http.StatusForbidden, onlyOwnersPublish)
		return
	}
	if !s.withinPublishingChanges(w, r, who) {
		return
	}
	outcome, err := publishing.SetRuleEnabled(r.Context(), s.Pool, who.CompanyID, who.UserID, ruleID, *input.Enabled)
	switch {
	case err != nil:
		s.failed(w, "autopublish rule", err)
	case outcome == "not-allowed":
		problem(w, http.StatusForbidden, onlyOwnersPublish)
	case outcome == "not-found":
		problem(w, http.StatusNotFound, "We couldn't find that rule. Reload the page.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": outcome})
	}
}
