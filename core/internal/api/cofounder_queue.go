package api

import (
	"net/http"
	"strings"
	"time"

	"ansa/core/internal/publishing"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
)

// The Co-Founder's publishing queue (the old services/publishing-pages.ts,
// draft-publishing.ts, publish-scheduling.ts, publish-job-actions.ts,
// autopublish-rules.ts): everyone in the company reads; only owners act
// (checked here for a clear message, and again by core/internal/publishing
// with the role read FOR SHARE inside the write's transaction).

// Scheduling, cancelling, sending, retrying, marking and the rules: 120 per
// 10 minutes per person (the old publishing-changes counter).
var publishingChanges = ratelimit.Rule{MaxAttempts: 120, Window: 10 * time.Minute}

// The accounts one schedule may pick at once (a company has a few per platform).
const scheduleAccountsMax = 20

const onlyOwnersPublish = "Only owners schedule, cancel, retry or mark posts, and change the auto-publish rules."

func (s *Server) registerCofounderQueue(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/cofounder/queue", s.withSession(s.queuePage))
	routes.HandleFunc("GET /api/v1/cofounder/publishing/drafts/{id}", s.withSession(s.draftPublishing))
	routes.HandleFunc("POST /api/v1/cofounder/publishing/drafts/{id}/schedule", s.withSession(s.scheduleDraft))
	for _, action := range []string{"cancel", "publish-now", "retry", "mark-published", "mark-not-published"} {
		routes.HandleFunc("POST /api/v1/cofounder/queue/jobs/{id}/"+action, s.withSession(s.publishJobAction(action)))
	}
	routes.HandleFunc("POST /api/v1/cofounder/queue/rules", s.withSession(s.createAutopublishRule))
	routes.HandleFunc("POST /api/v1/cofounder/queue/rules/{id}", s.withSession(s.switchAutopublishRule))
}

// queuePage: GET, the queue page (publishing.QueuePage).
func (s *Server) queuePage(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	page, err := publishing.ReadQueuePage(r.Context(), s.Pool, who.CompanyID, who.IsOwner(), time.Now())
	if err != nil {
		s.failed(w, "queue page", err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// draftPublishing: GET, a draft's Publish section (publishing.DraftPublishing).
func (s *Server) draftPublishing(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("id"))
	if !uuidPattern.MatchString(id) {
		problem(w, http.StatusNotFound, "We couldn't find that draft or post. Reload the page.")
		return
	}
	section, err := publishing.ReadDraftPublishing(r.Context(), s.Pool, who.CompanyID, id, who.IsOwner(), time.Now())
	switch {
	case err != nil:
		s.failed(w, "draft publishing", err)
	case section == nil:
		problem(w, http.StatusNotFound, "We couldn't find that draft or post. Reload the page.")
	default:
		writeJSON(w, http.StatusOK, section)
	}
}

// scheduleInput is what the schedule form sends: the version the page
// showed, the accounts picked, "now" or "later" with one UTC instant the
// browser made from the date and time typed in the viewer's own timezone
// ("2026-11-03T14:30:00.000Z"), and the owner's tick "without an approval".
type scheduleInput struct {
	Version         int      `json:"version"`
	ConnectionIDs   []string `json:"connectionIds"`
	When            string   `json:"when"`
	ScheduledFor    *string  `json:"scheduledFor"`
	WithoutApproval bool     `json:"withoutApproval"`
}

// scheduleDraft: POST, schedules one draft (owners). Answers {"outcome":
// "scheduled", "jobIds", "mode"}; posts due already go out right after.
func (s *Server) scheduleDraft(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	draftID := strings.ToLower(r.PathValue("id"))
	var input scheduleInput
	if !uuidPattern.MatchString(draftID) || !readJSON(body, &input) || input.Version < 1 {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page and try again.")
		return
	}
	accounts, at, fields := readSchedule(input)
	if len(fields) > 0 {
		fieldProblems(w, fields)
		return
	}
	if !who.IsOwner() {
		problem(w, http.StatusForbidden, onlyOwnersPublish)
		return
	}
	now := time.Now()
	if at != nil {
		if when := publishing.CheckScheduleTime(*at, now); when != "ok" {
			fieldProblems(w, map[string]string{"scheduledFor": map[string]string{"past": "That time has passed: pick a later one, or Now.", "too_far": "Pick a time within the next year."}[when]})
			return
		}
	}
	if !s.withinPublishingChanges(w, r, who) {
		return
	}
	request := publishing.ScheduleRequest{DraftID: draftID, ShownVersion: input.Version, ConnectionIDs: accounts, At: at, WithoutApproval: input.WithoutApproval}
	scheduled, err := publishing.Schedule(r.Context(), s.Pool, who.CompanyID, who.UserID, request)
	switch {
	case err != nil:
		s.failed(w, "schedule", err)
	case scheduled.Outcome != "scheduled":
		s.refuseSchedule(w, scheduled.Outcome)
	default:
		// Due already (now, or a time typed a moment ago): sent right after the answer.
		if at == nil || !at.After(now) {
			s.sendSoon(who, scheduled.JobIDs)
		}
		writeJSON(w, http.StatusOK, map[string]any{"outcome": "scheduled", "jobIds": scheduled.JobIDs, "mode": scheduled.Mode})
	}
}

// readSchedule checks the form: the accounts (each once, lowercased), and
// the time (nil: now). fields: what is wrong with each field, in the old
// form's words.
func readSchedule(input scheduleInput) (accounts []string, at *time.Time, fields map[string]string) {
	fields = map[string]string{}
	seen := map[string]bool{}
	for _, id := range input.ConnectionIDs {
		id = strings.ToLower(id)
		if !uuidPattern.MatchString(id) {
			fields["connectionIds"] = "Reload the page and pick again."
		} else if !seen[id] {
			seen[id] = true
			accounts = append(accounts, id)
		}
	}
	switch {
	case len(accounts) == 0:
		fields["connectionIds"] = "Pick at least one account."
	case len(accounts) > scheduleAccountsMax:
		fields["connectionIds"] = "Pick at most 20 accounts."
	}
	text := ""
	if input.ScheduledFor != nil {
		text = *input.ScheduledFor
	}
	switch {
	case input.When != "now" && input.When != "later":
		fields["when"] = "Pick when it goes out."
	case input.When == "later" && text == "":
		fields["scheduledFor"] = "Pick a date and a time."
	case input.When == "later":
		// One UTC instant, as the browser makes it (an ISO time ending in Z).
		instant, err := time.Parse(time.RFC3339Nano, text)
		if err != nil || !strings.HasSuffix(text, "Z") {
			fields["scheduledFor"] = "Pick a date and a time."
		} else {
			at = &instant
		}
	}
	return accounts, at, fields
}

// withinPublishingChanges counts the person's change; past the limit it
// answers 429 and says false.
func (s *Server) withinPublishingChanges(w http.ResponseWriter, r *http.Request, who *session.Session) bool {
	if over, err := s.Limiter.Over(r.Context(), "publishing-changes", who.UserID, publishingChanges); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many changes. Try again in a few minutes.")
		return false
	}
	return true
}

// sendSoon sends posts that just became due right after the answer; the
// scheduler's next round sends them otherwise.
func (s *Server) sendSoon(who *session.Session, jobIDs []string) {
	if s.Publisher != nil {
		s.Publisher.SendSoon(who.CompanyID, jobIDs)
	}
}
