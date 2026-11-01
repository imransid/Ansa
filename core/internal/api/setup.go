package api

import (
	"net/http"

	"ansa/core/internal/session"
	"ansa/core/internal/settings"
	"ansa/core/internal/setup"
)

const ownersSetUp = "Only owners can change ansa's setup."

func (s *Server) registerSetup(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/setup", s.withSession(s.setupProfile))
	routes.HandleFunc("POST /api/v1/setup/{section}", s.withSession(s.ownersOnly(ownersSetUp, s.saveSetupSection)))
}

// setupProfile: GET /api/v1/setup, everyone reads it.
func (s *Server) setupProfile(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	profile, err := setup.ReadProfile(r.Context(), s.Pool, who.CompanyID)
	if err != nil {
		s.failed(w, "setup profile", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": profile, "canManage": who.IsOwner()})
}

// saveSetupSection: POST /api/v1/setup/{business|contact|hours|away|orders|assistant|connect|finish}
// ?from=setup (it also counts as that setup step done) or from Settings.
// Answers {"nextStep"}.
func (s *Server) saveSetupSection(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	ctx := r.Context()
	profile, err := setup.ReadProfile(ctx, s.Pool, who.CompanyID)
	if err != nil {
		s.failed(w, "setup", err)
		return
	}
	section := r.PathValue("section")
	reached := 0
	if r.URL.Query().Get("from") == "setup" {
		reached = setup.StepNumber(section, profile.Kind)
	}
	var outcome string
	var fields setup.Fields
	switch section {
	case "business":
		var b setup.Business
		if fields = decodeAnd(body, &b, b.Check); fields == nil {
			outcome, err = setup.SaveBusiness(ctx, s.Pool, who.CompanyID, who.UserID, b, reached)
		}
	case "contact":
		var c setup.Contact
		if fields = decodeAnd(body, &c, c.Check); fields == nil {
			outcome, err = setup.SaveContact(ctx, s.Pool, who.CompanyID, who.UserID, c, reached)
		}
	case "hours", "away":
		var week setup.Week
		if !readJSON(body, &week) {
			fields = setup.Fields{"form": "Something went wrong. Reload the page."}
			break
		}
		typed, problems := week.Check(section == "away")
		if len(problems) > 0 {
			fields = problems
		} else if section == "hours" {
			outcome, err = setup.SaveHours(ctx, s.Pool, who.CompanyID, who.UserID, week.TimeZone, typed, reached)
		} else {
			outcome, err = setup.SaveAway(ctx, s.Pool, who.CompanyID, who.UserID, week.TimeZone, typed, week.ReplyGraceMinutes, reached)
		}
	case "orders":
		var o setup.Orders
		if fields = decodeAnd(body, &o, o.Check); fields == nil {
			outcome, err = setup.SaveOrders(ctx, s.Pool, who.CompanyID, who.UserID, o, reached)
		}
	case "assistant":
		var a setup.Answering
		if fields = decodeAnd(body, &a, a.Check); fields == nil {
			outcome, err = setup.SaveAnswering(ctx, s.Pool, who.CompanyID, who.UserID, a, reached)
		}
	case "connect":
		outcome, err = setup.RecordConnectDone(ctx, s.Pool, who.CompanyID, who.UserID, setup.StepNumber("connect", profile.Kind))
	case "finish":
		outcome, err = setup.Finish(ctx, s.Pool, who.CompanyID, who.UserID)
	default:
		problem(w, http.StatusNotFound, "Something went wrong. Reload the page.")
		return
	}
	s.answerSetup(w, r, who, section, outcome, fields, err)
}

func (s *Server) answerSetup(w http.ResponseWriter, r *http.Request, who *session.Session, section, outcome string, fields setup.Fields, err error) {
	switch {
	case err != nil:
		s.failed(w, "setup save", err)
	case len(fields) > 0:
		fieldProblems(w, fields)
	case outcome == setup.NotReady:
		problem(w, http.StatusConflict, "A setup step is still missing. Go back and save it first.")
	case outcome != settings.Saved:
		problem(w, http.StatusForbidden, ownersSetUp)
	default:
		// The kind may have just changed: the next step follows the new one.
		profile, err := setup.ReadProfile(r.Context(), s.Pool, who.CompanyID)
		if err != nil {
			s.failed(w, "setup", err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"nextStep": setup.NextStep(section, profile.Kind)})
	}
}

// decodeAnd reads the body into a section and runs its check: nil when
// all is well, else the problems.
func decodeAnd(body []byte, into any, check func() setup.Fields) setup.Fields {
	if !readJSON(body, into) {
		return setup.Fields{"form": "Something went wrong. Reload the page."}
	}
	if fields := check(); len(fields) > 0 {
		return fields
	}
	return nil
}
