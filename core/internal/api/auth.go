package api

import (
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"ansa/core/internal/accounts"
	"ansa/core/internal/addresses"
	"ansa/core/internal/httpserver"
	"ansa/core/internal/logging"
)

// The login pages' endpoints: signed by the screens like every request,
// but nobody is logged in yet. The browser talks to the screens only, so
// the screens send what they saw (the browser's IP, its browser and its
// known-device cookie) in the signed body, and set the cookies core answers.
func (s *Server) registerAuth(routes *http.ServeMux) {
	routes.HandleFunc("POST /api/v1/auth/signup", s.withScreens(s.signUp))
	routes.HandleFunc("POST /api/v1/auth/join", s.withScreens(s.join))
	routes.HandleFunc("POST /api/v1/auth/invite-preview", s.withScreens(s.invitePreview))
	routes.HandleFunc("POST /api/v1/auth/login", s.withScreens(s.logIn))
	routes.HandleFunc("POST /api/v1/auth/confirm", s.withScreens(s.confirmEmail))
	routes.HandleFunc("POST /api/v1/auth/reset-request", s.withScreens(s.requestReset))
	routes.HandleFunc("POST /api/v1/auth/reset", s.withScreens(s.resetPassword))
}

// publicHandler is an endpoint nobody needs to be logged in for.
type publicHandler func(w http.ResponseWriter, r *http.Request, body []byte)

// withScreens checks the body's size and the screens' signature only.
func (s *Server) withScreens(h publicHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := httpserver.ReadBody(r, maxBodyBytes)
		if err == httpserver.ErrTooLarge {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			return
		}
		if err != nil || !s.signedByScreens(r, body, time.Now()) {
			s.Log.Warn("api: request refused", logging.Code("not_signed"))
			w.WriteHeader(http.StatusForbidden)
			return
		}
		h(w, r, body)
	}
}

// browser is what the screens saw of the browser (in every public body).
type browser struct {
	ClientIP    string `json:"clientIp"`
	UserAgent   string `json:"userAgent"`
	KnownDevice string `json:"knownDevice"`
}

func (b browser) request() accounts.Request {
	return accounts.Request{IP: cutText(b.ClientIP, 100), UserAgent: b.UserAgent, KnownDeviceCookie: cutText(b.KnownDevice, 300)}
}

var (
	inviteTokenPattern  = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
	confirmTokenPattern = regexp.MustCompile(`^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`)
	resetTokenPattern   = regexp.MustCompile(`^[A-Za-z0-9]{24}$`)
)

// newPerson checks a signup's name (1-100, no control characters), address
// (the team account rule) and password (12-128).
func newPerson(name, email, password string) (accounts.NewPerson, map[string]string) {
	problems := map[string]string{}
	name = strings.TrimSpace(name)
	switch {
	case name == "":
		problems["name"] = "Enter your name"
	case utf8.RuneCountInString(name) > 100:
		problems["name"] = "Name must be at most 100 characters"
	case strings.ContainsFunc(name, unicode.IsControl):
		problems["name"] = "Name can't contain line breaks or other control characters"
	}
	address, why := addresses.AccountEmail(email)
	if why != "" {
		problems["email"] = why
	}
	if why := newPasswordProblem(password); why != "" {
		problems["password"] = why
	}
	return accounts.NewPerson{Name: name, Email: address, Password: password}, problems
}

// newPasswordProblem: a new password is 12 to 128 characters.
func newPasswordProblem(password string) string {
	switch length := utf8.RuneCountInString(password); {
	case length < accounts.PasswordMin:
		return "Password must be at least 12 characters"
	case length > accounts.PasswordMax:
		return "Password must be at most 128 characters"
	}
	return ""
}

// signUp: {name, email, password, ...browser}. "check your email" for
// every address (an existing one is told by email only).
func (s *Server) signUp(w http.ResponseWriter, r *http.Request, body []byte) {
	var input struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
		browser
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	person, problems := newPerson(input.Name, input.Email, input.Password)
	if len(problems) > 0 {
		fieldProblems(w, problems)
		return
	}
	message, err := s.Accounts.SignUp(r.Context(), person, input.request())
	s.checkYourEmail(w, "signup", message, err)
}

// join: {inviteToken, name, email, password, ...browser}.
func (s *Server) join(w http.ResponseWriter, r *http.Request, body []byte) {
	var input struct {
		InviteToken string `json:"inviteToken"`
		Name        string `json:"name"`
		Email       string `json:"email"`
		Password    string `json:"password"`
		browser
	}
	if !readJSON(body, &input) || !inviteTokenPattern.MatchString(input.InviteToken) {
		problem(w, http.StatusBadRequest, "This invite link is not valid")
		return
	}
	person, problems := newPerson(input.Name, input.Email, input.Password)
	if len(problems) > 0 {
		fieldProblems(w, problems)
		return
	}
	message, err := s.Accounts.JoinWithInvite(r.Context(), input.InviteToken, person, input.request())
	s.checkYourEmail(w, "join", message, err)
}

func (s *Server) checkYourEmail(w http.ResponseWriter, what, message string, err error) {
	switch {
	case err != nil:
		s.failed(w, what, err)
	case message != "":
		problem(w, http.StatusBadRequest, message)
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "check-your-email"})
	}
}

// invitePreview: {inviteToken, ...browser} → who the invite is for.
func (s *Server) invitePreview(w http.ResponseWriter, r *http.Request, body []byte) {
	var input struct {
		InviteToken string `json:"inviteToken"`
		browser
	}
	if !readJSON(body, &input) || !inviteTokenPattern.MatchString(input.InviteToken) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "not-usable"})
		return
	}
	preview, limited, err := s.Accounts.PreviewInvite(r.Context(), input.InviteToken, input.request())
	switch {
	case err != nil:
		s.failed(w, "invite preview", err)
	case limited:
		writeJSON(w, http.StatusOK, map[string]string{"status": "rate-limited"})
	case preview == nil:
		writeJSON(w, http.StatusOK, map[string]string{"status": "not-usable"})
	default:
		writeJSON(w, http.StatusOK, map[string]any{"status": "ready", "preview": preview})
	}
}

// logIn: {email, password, ...browser} → the cookies to set, or a message.
func (s *Server) logIn(w http.ResponseWriter, r *http.Request, body []byte) {
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		browser
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	address, why := addresses.AccountEmail(input.Email)
	problems := map[string]string{}
	if why != "" {
		problems["email"] = why
	}
	if input.Password == "" || utf8.RuneCountInString(input.Password) > accounts.PasswordMax {
		problems["password"] = "Enter your password"
	}
	if len(problems) > 0 {
		fieldProblems(w, problems)
		return
	}
	answer, err := s.Accounts.LogIn(r.Context(), address, input.Password, input.request())
	s.answerLogin(w, "login", answer, err)
}

// confirmEmail: {token, password, ...browser}: the link AND the password.
func (s *Server) confirmEmail(w http.ResponseWriter, r *http.Request, body []byte) {
	var input struct {
		Token    string `json:"token"`
		Password string `json:"password"`
		browser
	}
	wrong := "This link has expired or the password is wrong. Try your password again, or log in to get a new link."
	if !readJSON(body, &input) || len(input.Token) > 2000 || !confirmTokenPattern.MatchString(input.Token) || input.Password == "" || utf8.RuneCountInString(input.Password) > accounts.PasswordMax {
		problem(w, http.StatusBadRequest, wrong)
		return
	}
	answer, err := s.Accounts.ConfirmEmail(r.Context(), input.Token, input.Password, input.request())
	s.answerLogin(w, "confirm", answer, err)
}

func (s *Server) answerLogin(w http.ResponseWriter, what string, answer accounts.Answer, err error) {
	switch {
	case err != nil:
		s.failed(w, what, err)
	case answer.Message != "":
		problem(w, http.StatusBadRequest, answer.Message)
	default:
		writeJSON(w, http.StatusOK, map[string]any{"cookies": answer.Cookies})
	}
}

// requestReset: {email, ...browser}: the same answer for every address.
func (s *Server) requestReset(w http.ResponseWriter, r *http.Request, body []byte) {
	var input struct {
		Email string `json:"email"`
		browser
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	address, why := addresses.AccountEmail(input.Email)
	if why != "" {
		fieldProblems(w, map[string]string{"email": why})
		return
	}
	message, err := s.Accounts.RequestReset(r.Context(), address, input.request())
	s.checkYourEmail(w, "reset request", message, err)
}

// resetPassword: {token, newPassword, ...browser}.
func (s *Server) resetPassword(w http.ResponseWriter, r *http.Request, body []byte) {
	var input struct {
		Token       string `json:"token"`
		NewPassword string `json:"newPassword"`
		browser
	}
	if !readJSON(body, &input) || !resetTokenPattern.MatchString(input.Token) {
		problem(w, http.StatusBadRequest, "This link has expired or is not valid. Ask for a new one.")
		return
	}
	if why := newPasswordProblem(input.NewPassword); why != "" {
		fieldProblems(w, map[string]string{"newPassword": why})
		return
	}
	outcome, message, err := s.Accounts.ResetWithToken(r.Context(), input.Token, input.NewPassword, input.request())
	switch {
	case err != nil:
		s.failed(w, "reset", err)
	case message != "":
		problem(w, http.StatusBadRequest, message)
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": outcome})
	}
}

func cutText(text string, limit int) string {
	if len(text) > limit {
		return text[:limit]
	}
	return text
}
