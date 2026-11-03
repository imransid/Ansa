package api

import (
	"net/http"

	"ansa/core/internal/inbox"
	"ansa/core/internal/session"
)

// "Answer now" (development only): ansa answers a conversation it waits on
// ("if I haven't answered within N minutes", step 51) at the scheduler's
// next round instead of at its time, so trying it out needn't wait the
// minutes out. On a real server the minutes are the owner's promise to
// their customers' people, so nothing shortens them.

// developmentOnly: "Answer now" asked of a production server.
const developmentOnly = "development-only"

const answerNowOnly = "Answer now is for trying ansa out on this computer: on a real server ansa answers when the minutes are up."

// answerNow: POST /api/v1/conversations/{id}/answer-now (owners, the
// inbox-changes limit): the catch-up's next round (15 s) answers it.
func (s *Server) answerNow(r *http.Request, body []byte, who *session.Session, id string) (string, error) {
	switch {
	case !readJSON(orEmpty(body), &struct{}{}):
		return inbox.NotFound, nil
	case !s.Development:
		return developmentOnly, nil
	case !who.IsOwner():
		return inbox.OwnersOnly, nil
	}
	return inbox.AnswerNow(r.Context(), s.Pool, who.CompanyID, who.UserID, id)
}
