package api

import (
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"ansa/core/internal/session"
)

func (s *Server) registerAccount(routes *http.ServeMux) {
	// Signed by the screens, no live login needed: a login that already
	// ended still gets the cookie that clears it from the browser.
	routes.HandleFunc("POST /api/v1/auth/logout", s.withScreens(s.logOut))
	routes.HandleFunc("GET /api/v1/account", s.withSession(s.accountPage))
	routes.HandleFunc("POST /api/v1/account/name", s.withSession(s.changeName))
	routes.HandleFunc("POST /api/v1/account/password", s.withSession(s.changePassword))
	routes.HandleFunc("POST /api/v1/account/logout-others", s.withSession(s.logOutOthers))
}

// logOut ends this login (if it still exists) and answers the cookie that clears it.
func (s *Server) logOut(w http.ResponseWriter, r *http.Request, _ []byte) {
	cleared, err := s.Accounts.LogOut(r.Context(), s.Sessions.Token(r))
	if err != nil {
		s.failed(w, "logout", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"cookies": []any{cleared}})
}

// accountPage: your name, your address, and how many browsers are logged in.
func (s *Server) accountPage(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	details, err := s.Accounts.ReadDetails(r.Context(), who.CompanyID, who.UserID)
	if err != nil {
		s.failed(w, "account", err)
		return
	}
	writeJSON(w, http.StatusOK, details)
}

// changeName: {name}.
func (s *Server) changeName(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Name string `json:"name"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	name := strings.TrimSpace(input.Name)
	switch {
	case name == "":
		fieldProblems(w, map[string]string{"name": "Enter your name"})
		return
	case utf8.RuneCountInString(name) > 100:
		fieldProblems(w, map[string]string{"name": "Name must be at most 100 characters"})
		return
	case strings.ContainsFunc(name, unicode.IsControl):
		fieldProblems(w, map[string]string{"name": "Name can't contain line breaks or other control characters"})
		return
	}
	message, err := s.Accounts.ChangeName(r.Context(), who.CompanyID, who.UserID, name)
	s.saved(w, "name", message, err)
}

// changePassword: {currentPassword, newPassword, ...browser} → this
// browser's fresh login cookie (every other login ends).
func (s *Server) changePassword(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
		browser
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	problems := map[string]string{}
	if input.CurrentPassword == "" || utf8.RuneCountInString(input.CurrentPassword) > 128 {
		problems["currentPassword"] = "Enter your current password"
	}
	if why := newPasswordProblem(input.NewPassword); why != "" {
		problems["newPassword"] = why
	}
	if len(problems) > 0 {
		fieldProblems(w, problems)
		return
	}
	answer, wrongCurrent, err := s.Accounts.ChangePassword(r.Context(), who.CompanyID, who.UserID, input.CurrentPassword, input.NewPassword, input.request())
	switch {
	case err != nil:
		s.failed(w, "password change", err)
	case wrongCurrent != "":
		fieldProblems(w, map[string]string{"currentPassword": wrongCurrent})
	default:
		s.answerLogin(w, "password change", answer, nil)
	}
}

// logOutOthers ends every other login, keeping this browser's.
func (s *Server) logOutOthers(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	message, err := s.Accounts.LogOutOthers(r.Context(), who.UserID, s.Sessions.Token(r))
	s.saved(w, "logout others", message, err)
}

func (s *Server) saved(w http.ResponseWriter, what, message string, err error) {
	switch {
	case err != nil:
		s.failed(w, what, err)
	case message != "":
		problem(w, http.StatusTooManyRequests, message)
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "saved"})
	}
}
