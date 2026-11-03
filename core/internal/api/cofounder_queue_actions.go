package api

import (
	"net/http"
	"strings"
	"unicode"
	"unicode/utf8"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/publishing"
	"ansa/core/internal/session"
)

// What a refused schedule or retry says (the old publish-messages.ts), so
// every form words the same outcome the same way.
var scheduleRefusals = map[string]string{
	"not-found":             "We couldn't find that draft or post. Reload the page.",
	"not-retryable":         "This post is no longer failed or waiting for a check, so it wasn't tried again. Reload the page to see it.",
	"stale":                 "Someone changed this draft after you opened it, so nothing was scheduled. Reload the page to see their change.",
	"wrong-status":          "This draft can't go out now: an idea, a rejected or an archived draft is never published.",
	"not-approved":          "An owner approves this version of the draft first. (With an auto-publish rule switched on for it, you can also choose to send it without an approval.)",
	"approver-gone":         "The owner who approved this draft is no longer an owner of the company: an owner approves it again first.",
	"no-rule":               "No auto-publish rule that is switched on covers this draft's platform and content pillar, so it needs an owner's approval.",
	"rule-owner-gone":       "An owner behind the auto-publish rule is no longer an owner of the company, so the rule can't send it: approve the draft instead.",
	"format-not-published":  "ansa can't publish this kind of post to this platform yet.",
	"blocked":               "This draft breaks one of its platform's rules or uses a word to avoid (see Checks on its page): fix it first.",
	"claims-need-owner":     "A claim in this draft isn't backed by a confirmed fact, or its text was changed by hand, so it can't go out without an owner's approval.",
	"account-not-connected": "An account you picked isn't connected any more (or isn't on this draft's platform). Reload the page and pick again.",
	"already-scheduled":     "This draft is already scheduled, published or waiting for a check on an account you picked.",
}

// What an owner's action says when the post's status changed meanwhile (it
// went out, or someone acted first).
var changedMeanwhile = map[string]string{
	"cancel":             "This post is no longer waiting (it is going out, or went out), so it can't be canceled. Reload the page to see it.",
	"publish-now":        "This post is no longer waiting (it is going out, or went out). Reload the page to see it.",
	"mark-published":     "This post no longer needs attention: someone handled it meanwhile. Reload the page to see it.",
	"mark-not-published": "This post no longer needs attention: someone handled it meanwhile. Reload the page to see it.",
}

func (s *Server) refuseSchedule(w http.ResponseWriter, outcome string) {
	switch outcome {
	case "not-allowed":
		problem(w, http.StatusForbidden, onlyOwnersPublish)
	case "not-found":
		problem(w, http.StatusNotFound, scheduleRefusals[outcome])
	default:
		problem(w, http.StatusConflict, scheduleRefusals[outcome])
	}
}

// publishJobAction: POST, an owner's action on one post: cancel,
// publish-now, retry, mark-published ({"url"}: the post's address on its
// platform, optional) or mark-not-published. Answers {"outcome": "changed"}
// (a retry: "retried"). A post sent now or tried again goes out right after.
func (s *Server) publishJobAction(action string) handler {
	return func(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
		jobID := strings.ToLower(r.PathValue("id"))
		var input struct {
			URL string `json:"url"`
		}
		if !uuidPattern.MatchString(jobID) || (len(body) > 0 && !readJSON(body, &input)) {
			problem(w, http.StatusBadRequest, "Unknown post. Reload the page and try again.")
			return
		}
		address := strings.TrimSpace(input.URL)
		if wrong := addressProblem(address); action == "mark-published" && wrong != "" {
			fieldProblems(w, map[string]string{"url": wrong})
			return
		}
		if !who.IsOwner() {
			problem(w, http.StatusForbidden, onlyOwnersPublish)
			return
		}
		if action == "mark-published" {
			var ok bool
			if address, ok = s.postAddress(w, r, who, jobID, address); !ok {
				return
			}
		}
		if !s.withinPublishingChanges(w, r, who) {
			return
		}
		s.runJobAction(w, r, who, action, jobID, address)
	}
}

// addressProblem is what is wrong with a typed post address ("" = nothing).
func addressProblem(address string) string {
	if utf8.RuneCountInString(address) > publishing.PostURLMax {
		return "That address is too long."
	}
	if strings.IndexFunc(address, unicode.IsControl) >= 0 {
		return "That isn't a web address."
	}
	return ""
}

// postAddress is the address kept for "Mark as published": only https on
// the post's platform's own hosts ("" = none given). False: it answered.
func (s *Server) postAddress(w http.ResponseWriter, r *http.Request, who *session.Session, jobID, typed string) (string, bool) {
	platform, err := publishing.JobPlatform(r.Context(), s.Pool, who.CompanyID, jobID)
	switch {
	case err != nil:
		s.failed(w, "publish job", err)
		return "", false
	case platform == "":
		problem(w, http.StatusNotFound, "We couldn't find that post. Reload the page.")
		return "", false
	case typed == "":
		return "", true
	}
	stored := publishing.ReadPostURL(typed, platform)
	if stored == "" {
		fieldProblems(w, map[string]string{"url": "Paste the post's address on " + contentrules.PlatformLabels[platform] + " (https://...), or leave it empty."})
		return "", false
	}
	return stored, true
}

func (s *Server) runJobAction(w http.ResponseWriter, r *http.Request, who *session.Session, action, jobID, address string) {
	ctx, company := r.Context(), who.CompanyID
	var outcome string
	var err error
	switch action {
	case "cancel":
		outcome, err = publishing.CancelJob(ctx, s.Pool, company, who.UserID, jobID)
	case "publish-now":
		outcome, err = publishing.PublishJobNow(ctx, s.Pool, company, who.UserID, jobID)
	case "retry":
		outcome, err = publishing.RetryJob(ctx, s.Pool, company, who.UserID, jobID)
	case "mark-published":
		outcome, err = publishing.MarkJobPublished(ctx, s.Pool, company, who.UserID, jobID, address)
	default:
		outcome, err = publishing.MarkJobNotPublished(ctx, s.Pool, company, who.UserID, jobID)
	}
	switch {
	case err != nil:
		s.failed(w, "publish job", err)
	case outcome == "changed" || outcome == "retried":
		if action == "publish-now" || action == "retry" {
			s.sendSoon(who, []string{jobID})
		}
		writeJSON(w, http.StatusOK, map[string]string{"outcome": outcome})
	case action == "retry":
		// A retry is checked like a new schedule, and worded so.
		s.refuseSchedule(w, outcome)
	case outcome == "not-found":
		problem(w, http.StatusNotFound, "We couldn't find that post. Reload the page.")
	case outcome == "wrong-status":
		problem(w, http.StatusConflict, changedMeanwhile[action])
	default:
		problem(w, http.StatusForbidden, onlyOwnersPublish)
	}
}
