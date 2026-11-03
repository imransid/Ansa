package brainclient

import "time"

// How long core waits for the brain's answer, per use. Each is longer than
// the brain's longest ask for that use: every try timing out, plus the
// longest wait between tries (brain/brain/ai.py), or Claude Code's time
// limit in development (brain/brain/claude_code.py). waits_test.go reads
// both brain files and checks it, so tuning either side can't leave core
// giving up on answers the brain is still paying for.
const (
	// A customer's reply, "Try your assistant", the catch-up, and a live
	// call's turns and its note.
	AssistantReplyWait = 120 * time.Second
	// Answering a comment on a Facebook post.
	CommentReplyWait = 120 * time.Second
	// Triaging a received email.
	EmailTriageWait = 120 * time.Second
	// Deciding a finished phone call.
	CallDecisionWait = 260 * time.Second
	// Writing one "Post for me" post.
	AutopostWait = 135 * time.Second
	// Reading a menu, and a PDF's text for knowledge (no AI: much faster).
	MenuReadingWait = 260 * time.Second
	// "Review performance".
	PerformanceReviewWait = 260 * time.Second
	// A content studio draft.
	ContentDraftWait = 260 * time.Second
	// The Co-Founder: an interview turn, facts from an article, a marketing
	// plan, two weeks of post ideas.
	CofounderWait = 285 * time.Second
	// The brain's status (which AI engines it can use): no AI.
	StatusWait = 5 * time.Second
	// Hearing a practice call's recording with local Whisper (development only).
	VoiceWait = 70 * time.Second
)
