package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"ansa/core/internal/menu"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
)

// A person's menu changes: 120 per 10 minutes (the old counter).
var menuChanges = ratelimit.Rule{MaxAttempts: 120, Window: 10 * time.Minute}

var menuRefusals = map[string]string{
	menu.NotAllowed: "Only owners can change the menu.",
	menu.NotFound:   "This dish is no longer on the menu. Reload the page.",
	menu.TooMany:    "A menu holds at most 500 dishes. Delete some first.",
}

const noCurrency = "Choose your currency in What it knows first: every price is in it."

func (s *Server) registerMenu(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/menu", s.withSession(s.readMenu))
	routes.HandleFunc("POST /api/v1/menu/items", s.withSession(s.menuChange(true, s.addDish)))
	routes.HandleFunc("POST /api/v1/menu/items/{id}", s.withSession(s.menuChange(true, s.updateDish)))
	routes.HandleFunc("POST /api/v1/menu/items/{id}/delete", s.withSession(s.menuChange(true, s.deleteDish)))
	routes.HandleFunc("POST /api/v1/menu/items/{id}/move", s.withSession(s.menuChange(true, s.moveDish)))
	routes.HandleFunc("POST /api/v1/menu/items/{id}/availability", s.withSession(s.menuChange(false, s.dishAvailability)))
	routes.HandleFunc("POST /api/v1/menu/reading/confirm", s.withSession(s.menuChange(true, s.confirmReading)))
}

// readMenu: GET /api/v1/menu, everyone reads it.
func (s *Server) readMenu(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	items, err := menu.List(r.Context(), s.Pool, who.CompanyID)
	if err == nil {
		var currency string
		if currency, err = menu.Currency(r.Context(), s.Pool, who.CompanyID); err == nil {
			writeJSON(w, http.StatusOK, map[string]any{"items": items, "currency": currency, "canEdit": who.IsOwner()})
			return
		}
	}
	s.failed(w, "menu", err)
}

// menuChange checks who may (owners, or anyone for availability), the
// limit, and the dish's id, then answers the change's outcome.
func (s *Server) menuChange(ownersOnly bool, change func(r *http.Request, body []byte, who *session.Session, id string) (string, map[string]string, error)) handler {
	return func(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
		if ownersOnly && !who.IsOwner() {
			problem(w, http.StatusForbidden, menuRefusals[menu.NotAllowed])
			return
		}
		if over, err := s.Limiter.Over(r.Context(), "menu-changes", who.UserID, menuChanges); err != nil || over {
			problem(w, http.StatusTooManyRequests, "Too many changes. Try again in a few minutes.")
			return
		}
		id := strings.ToLower(r.PathValue("id"))
		if r.PathValue("id") != "" && !uuidPattern.MatchString(id) {
			problem(w, http.StatusNotFound, menuRefusals[menu.NotFound])
			return
		}
		outcome, fields, err := change(r, body, who, id)
		switch {
		case err != nil:
			s.failed(w, "menu change", err)
		case len(fields) > 0:
			fieldProblems(w, fields)
		case outcome == menu.Saved:
			writeJSON(w, http.StatusOK, map[string]string{})
		case menuRefusals[outcome] != "":
			problem(w, map[string]int{menu.NotAllowed: 403, menu.NotFound: 404, menu.TooMany: 409}[outcome], menuRefusals[outcome])
		default:
			problem(w, http.StatusBadRequest, outcome)
		}
	}
}

// typedDish reads one typed dish and prices it in the menu's currency.
func (s *Server) typedDish(r *http.Request, body []byte, who *session.Session) (menu.Fields, map[string]string, string, error) {
	var typed menu.Typed
	if !readJSON(body, &typed) {
		return menu.Fields{}, nil, menu.NotFound, nil
	}
	currency, err := menu.Currency(r.Context(), s.Pool, who.CompanyID)
	if err != nil || currency == "" {
		return menu.Fields{}, nil, noCurrency, err
	}
	fields, problems := typed.Check(currency)
	return fields, problems, "", nil
}

func (s *Server) addDish(r *http.Request, body []byte, who *session.Session, _ string) (string, map[string]string, error) {
	fields, problems, refusal, err := s.typedDish(r, body, who)
	if err != nil || refusal != "" || len(problems) > 0 {
		return refusal, problems, err
	}
	outcome, err := menu.Add(r.Context(), s.Pool, who.CompanyID, who.UserID, []menu.Fields{fields})
	return outcome, nil, err
}

func (s *Server) updateDish(r *http.Request, body []byte, who *session.Session, id string) (string, map[string]string, error) {
	fields, problems, refusal, err := s.typedDish(r, body, who)
	if err != nil || refusal != "" || len(problems) > 0 {
		return refusal, problems, err
	}
	outcome, err := menu.Update(r.Context(), s.Pool, who.CompanyID, who.UserID, id, fields)
	return outcome, nil, err
}

func (s *Server) deleteDish(r *http.Request, _ []byte, who *session.Session, id string) (string, map[string]string, error) {
	outcome, err := menu.Delete(r.Context(), s.Pool, who.CompanyID, who.UserID, id)
	return outcome, nil, err
}

func (s *Server) moveDish(r *http.Request, body []byte, who *session.Session, id string) (string, map[string]string, error) {
	var input struct {
		Direction string `json:"direction"`
	}
	if !readJSON(body, &input) || (input.Direction != "up" && input.Direction != "down") {
		return menu.NotFound, nil, nil
	}
	outcome, err := menu.Move(r.Context(), s.Pool, who.CompanyID, who.UserID, id, input.Direction)
	return outcome, nil, err
}

func (s *Server) dishAvailability(r *http.Request, body []byte, who *session.Session, id string) (string, map[string]string, error) {
	var input struct {
		Available *bool `json:"available"`
	}
	if !readJSON(body, &input) || input.Available == nil {
		return menu.NotFound, nil, nil
	}
	outcome, err := menu.SetAvailable(r.Context(), s.Pool, who.CompanyID, who.UserID, id, *input.Available, time.Now())
	return outcome, nil, err
}

// confirmReading: "Looks right", every dish of a reading as the owner left
// them, each checked again. All or none; a problem names its dish.
func (s *Server) confirmReading(r *http.Request, body []byte, who *session.Session, _ string) (string, map[string]string, error) {
	var input struct {
		Items []menu.Typed `json:"items"`
	}
	if !readJSON(body, &input) {
		return menu.NotFound, nil, nil
	}
	switch {
	case len(input.Items) == 0:
		return "There are no dishes to add.", nil, nil
	case len(input.Items) > menu.ItemsPerReadingMax:
		return "At most 150 dishes at a time.", nil, nil
	}
	currency, err := menu.Currency(r.Context(), s.Pool, who.CompanyID)
	if err != nil || currency == "" {
		return noCurrency, nil, err
	}
	dishes := make([]menu.Fields, 0, len(input.Items))
	for index, typed := range input.Items {
		fields, problems := typed.Check(currency)
		if len(problems) > 0 {
			return "Dish " + strconv.Itoa(index+1) + " (" + fields.Name + "): " + firstProblem(problems), nil, nil
		}
		dishes = append(dishes, fields)
	}
	outcome, err := menu.Add(r.Context(), s.Pool, who.CompanyID, who.UserID, dishes)
	return outcome, nil, err
}

// firstProblem is one problem, the price's first (the most common).
func firstProblem(problems map[string]string) string {
	for _, field := range []string{"price", "name", "category", "description"} {
		if problems[field] != "" {
			return strings.ToLower(problems[field][:1]) + problems[field][1:]
		}
	}
	return "check it"
}
