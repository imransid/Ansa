package api

import (
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"ansa/core/internal/addresses"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
	"ansa/core/internal/teammates"
)

// Creating and revoking invite links count apart, per company, so onboarding
// a big team isn't stopped by cleaning up old links (or the other way round).
var (
	inviteCreations   = ratelimit.Rule{MaxAttempts: 200, Window: time.Hour}
	inviteRevocations = ratelimit.Rule{MaxAttempts: 200, Window: time.Hour}
)

func (s *Server) registerTeam(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/team", s.withSession(s.teamPage))
	routes.HandleFunc("POST /api/v1/team/invites", s.withSession(s.createInvite))
	routes.HandleFunc("POST /api/v1/team/invites/{id}/revoke", s.withSession(s.revokeInvite))
	routes.HandleFunc("POST /api/v1/team/people/{id}/role", s.withSession(s.ownersOnly("Only owners can remove people or change roles.", s.changeRole)))
	routes.HandleFunc("POST /api/v1/team/people/{id}/remove", s.withSession(s.ownersOnly("Only owners can remove people or change roles.", s.removeTeammate)))
	routes.HandleFunc("POST /api/v1/team/people/{id}/categories", s.withSession(s.saveCategoriesOf))
	routes.HandleFunc("POST /api/v1/team/categories", s.withSession(s.ownersOnly("Only owners can manage categories.", s.createCategory)))
	routes.HandleFunc("POST /api/v1/team/categories/{id}/rename", s.withSession(s.ownersOnly("Only owners can manage categories.", s.renameCategory)))
	routes.HandleFunc("POST /api/v1/team/categories/{id}/archive", s.withSession(s.ownersOnly("Only owners can manage categories.", s.archiveCategory)))
}

// teamPage: GET, everyone reads the team; only owners see pending invites.
func (s *Server) teamPage(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	team, err := teammates.ReadTeam(r.Context(), s.Pool, who.CompanyID, who.IsOwner())
	if err != nil {
		s.failed(w, "team", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"team": team, "canManage": who.IsOwner(), "me": who.UserID})
}

// createInvite: {email, role} → {"link"}: the token after "#", so it never
// reaches a server or its logs.
func (s *Server) createInvite(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	if !who.IsOwner() {
		problem(w, http.StatusForbidden, "Only owners can manage invites.")
		return
	}
	var input struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	fields := map[string]string{}
	email, emailProblem := addresses.AccountEmail(input.Email)
	if emailProblem != "" {
		fields["email"] = emailProblem
	}
	if input.Role != "owner" && input.Role != "member" {
		fields["role"] = "Choose a role"
	}
	if len(fields) > 0 {
		fieldProblems(w, fields)
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "invite-creations", who.CompanyID.String(), inviteCreations); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many new invites. Try again in an hour.")
		return
	}
	token, outcome, err := teammates.CreateInvite(r.Context(), s.Pool, who.CompanyID, who.UserID, email, input.Role, time.Now())
	switch {
	case err != nil:
		s.failed(w, "invite", err)
	case outcome == "taken":
		fieldProblems(w, map[string]string{"email": "This address already belongs to someone on your team, or to someone removed from it."})
	case outcome != "created":
		problem(w, http.StatusForbidden, "Only owners can manage invites.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"link": s.AppURL + "/invite#" + token})
	}
}

// revokeInvite: the link stops working.
func (s *Server) revokeInvite(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("id"))
	switch {
	case !who.IsOwner():
		problem(w, http.StatusForbidden, "Only owners can manage invites.")
		return
	case !uuidPattern.MatchString(id):
		problem(w, http.StatusNotFound, "Unknown invite.")
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "invite-revocations", who.CompanyID.String(), inviteRevocations); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many revoked invites. Try again in an hour.")
		return
	}
	revoked, err := teammates.RevokeInvite(r.Context(), s.Pool, who.CompanyID, id)
	switch {
	case err != nil:
		s.failed(w, "invite revoke", err)
	case !revoked:
		problem(w, http.StatusConflict, "This invite is no longer pending.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "revoked"})
	}
}

// changeRole: {role} for one teammate, never yourself.
func (s *Server) changeRole(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Role string `json:"role"`
	}
	id := strings.ToLower(r.PathValue("id"))
	if !readJSON(body, &input) || (input.Role != "owner" && input.Role != "member") || !uuidOrText(id) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	if id == who.UserID {
		problem(w, http.StatusConflict, "You can't change your own role. Another owner can.")
		return
	}
	changed, err := teammates.SetRole(r.Context(), s.Pool, who.CompanyID, who.UserID, id, input.Role)
	switch {
	case err != nil:
		s.failed(w, "role", err)
	case !changed:
		problem(w, http.StatusConflict, "That didn't work: they may have left, not confirmed their email yet, or be the last owner.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "changed"})
	}
}

// removeTeammate: never yourself. Their open requests go back to routing.
func (s *Server) removeTeammate(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("id"))
	if !uuidOrText(id) {
		problem(w, http.StatusNotFound, "That person is not on your team, or was already removed.")
		return
	}
	if id == who.UserID {
		problem(w, http.StatusConflict, "You can't remove yourself. Another owner can.")
		return
	}
	removed, err := teammates.Remove(r.Context(), s.Pool, who.CompanyID, who.UserID, id)
	switch {
	case err != nil:
		s.failed(w, "remove", err)
	case !removed:
		problem(w, http.StatusNotFound, "That person is not on your team, or was already removed.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "removed"})
	}
}

// saveCategoriesOf: {categoryIds}. Anyone sets their own; owners anyone's.
func (s *Server) saveCategoriesOf(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		CategoryIDs []string `json:"categoryIds"`
	}
	id := strings.ToLower(r.PathValue("id"))
	if !readJSON(body, &input) || len(input.CategoryIDs) > 100 || !uuidOrText(id) {
		problem(w, http.StatusBadRequest, "Unknown person or category.")
		return
	}
	for index, categoryID := range input.CategoryIDs {
		input.CategoryIDs[index] = strings.ToLower(categoryID)
		if !uuidPattern.MatchString(categoryID) {
			problem(w, http.StatusBadRequest, "Unknown person or category.")
			return
		}
	}
	if id != who.UserID && !who.IsOwner() {
		problem(w, http.StatusForbidden, "You can only change your own categories.")
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "settings-changes", who.UserID, settingsChanges); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many changes. Try again in a few minutes.")
		return
	}
	saved, err := teammates.SaveCategoriesOf(r.Context(), s.Pool, who.CompanyID, id, input.CategoryIDs)
	switch {
	case err != nil:
		s.failed(w, "categories of", err)
	case !saved:
		problem(w, http.StatusBadRequest, "Unknown person or category.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "saved"})
	}
}

// createCategory: {name}.
func (s *Server) createCategory(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	name, ok := categoryName(w, body)
	if !ok {
		return
	}
	outcome, err := teammates.CreateCategory(r.Context(), s.Pool, who.CompanyID, name)
	switch {
	case err != nil:
		s.failed(w, "category", err)
	case outcome == "name-taken":
		fieldProblems(w, map[string]string{"name": "A category with that name already exists."})
	case outcome == "limit-reached":
		problem(w, http.StatusConflict, "You have 100 active categories, the most there can be. Archive one first.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "created"})
	}
}

// renameCategory: {name}; requests follow the new name.
func (s *Server) renameCategory(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	name, ok := categoryName(w, body)
	if !ok {
		return
	}
	outcome, err := teammates.RenameCategory(r.Context(), s.Pool, who.CompanyID, strings.ToLower(r.PathValue("id")), name)
	switch {
	case err != nil:
		s.failed(w, "category rename", err)
	case outcome == "name-taken":
		fieldProblems(w, map[string]string{"name": "A category with that name already exists."})
	case outcome == "not-found":
		problem(w, http.StatusNotFound, "Category not found.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "saved"})
	}
}

// archiveCategory: {archived}; restoring routes the requests waiting in it.
func (s *Server) archiveCategory(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Archived bool `json:"archived"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Unknown category.")
		return
	}
	outcome, err := teammates.SetCategoryArchived(r.Context(), s.Pool, who.CompanyID, strings.ToLower(r.PathValue("id")), input.Archived)
	switch {
	case err != nil:
		s.failed(w, "category archive", err)
	case outcome == "limit-reached":
		problem(w, http.StatusConflict, "You have 100 active categories, the most there can be. Archive one first.")
	case outcome == "not-found":
		problem(w, http.StatusNotFound, "Category not found.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "saved"})
	}
}

// categoryName reads {name}: trimmed, 1-50 characters, no < or >, no line
// break or other control character (the AI reads one name per line).
func categoryName(w http.ResponseWriter, body []byte) (string, bool) {
	var input struct {
		Name string `json:"name"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return "", false
	}
	name := strings.TrimSpace(input.Name)
	why := ""
	switch {
	case name == "":
		why = "Enter a category name"
	case utf8.RuneCountInString(name) > 50:
		why = "Category names can be at most 50 characters"
	case strings.ContainsAny(name, "<>"):
		why = "Category names can't contain < or >"
	case strings.ContainsFunc(name, unicode.IsControl):
		why = "Category names can't contain line breaks or other control characters"
	}
	if why != "" {
		fieldProblems(w, map[string]string{"name": why})
		return "", false
	}
	return name, true
}

// uuidOrText: a person's id (Better Auth's text ids are uuids here).
func uuidOrText(id string) bool {
	return id != "" && len(id) <= 100 && !strings.ContainsFunc(id, unicode.IsControl)
}
