package api

import (
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"ansa/core/internal/session"
	"ansa/core/internal/teammates"
)

// The Team page's categories (registered in team.go).

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
