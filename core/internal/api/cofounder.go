package api

import "net/http"

// registerCofounder adds the Co-Founder's endpoints of the business
// profile, the interview, the strategy, the calendar and the Overview
// (/api/v1/cofounder/...). The AI's answers come from s.CofounderBrain.
func (s *Server) registerCofounder(routes *http.ServeMux) {
	s.registerCofounderProfile(routes)
}
