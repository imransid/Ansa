package profile

// What the interview says next (the old lib/cofounder/interview-reply.ts),
// decided in code from the AI's turn and the profile. Pure.

const introduction = "Hi! I'm ansa's marketing planner. To help with your marketing I first need to know your business, so I'll ask you some questions, one at a time. What you tell me becomes proposed facts, and nothing counts until an owner confirms it on the Profile page."

const openingWhenComplete = "Your profile already has every key fact. Is there anything about the business you'd like to add or change?"

// FixedClosing: every key topic is confirmed or proposed and the reply was
// made without the AI: nothing more it must ask.
const FixedClosing = "Every key fact is now confirmed or waiting for you on the Profile page. Is there anything else about the business you'd like to add?"

// CouldNotReadNote comes before ansa's own question when the AI couldn't
// read the answer. Saved with it, so the conversation still says why the
// question came back.
const CouldNotReadNote = "I couldn't read that answer just now, so nothing was taken from it. You can also type any fact yourself on the Profile page."

// Turn is the AI's reading of one answer, checked by core.
type Turn struct {
	Proposals         []Proposal
	NextQuestion      string
	InterviewComplete bool
}

// Reply is what is saved as the interview's next message, and why.
type Reply struct {
	// One plain line.
	Text string
	// The reply closes the interview: no key topic is missing.
	EndsInterview bool
	// What to save as proposals (none without a usable turn).
	Proposals []Proposal
	// false: the AI couldn't read the answer, so nothing was taken from it.
	AIReadAnswer bool
	// The key topic of ansa's own fixed question, when ansa asked it ("" = none).
	FixedQuestionTopic string
}

// OpeningMessage is an interview's first message: fixed text, no AI. It
// asks about topic, the first key topic still missing when the page showed
// it ("" = none was missing).
func OpeningMessage(topic string) string {
	if found, ok := FindTopic(topic); ok {
		return introduction + " " + found.Question
	}
	return introduction + " " + openingWhenComplete
}

// BuildReply decides the reply to an owner's answer. Without a usable turn
// (nil) ansa asks its fixed question for the first key topic still
// missing, and proposes nothing. The AI may end the interview only when no
// key topic is missing once its proposals are counted: ending early would
// leave the owner thinking the profile is done, so the fixed question is
// asked instead (the AI's proposals are still saved).
func BuildReply(turn *Turn, facts Facts) Reply {
	if turn == nil {
		missing, isMissing := facts.FirstMissingKeyTopic()
		question := FixedClosing
		if isMissing {
			question = missing.Question
		}
		return Reply{Text: CouldNotReadNote + " " + question, EndsInterview: !isMissing, Proposals: []Proposal{}, FixedQuestionTopic: missing.Key}
	}
	missing, isMissing := facts.WithProposals(turn.Proposals).FirstMissingKeyTopic()
	if turn.InterviewComplete && isMissing {
		return Reply{Text: missing.Question, Proposals: turn.Proposals, AIReadAnswer: true, FixedQuestionTopic: missing.Key}
	}
	return Reply{Text: turn.NextQuestion, EndsInterview: turn.InterviewComplete, Proposals: turn.Proposals, AIReadAnswer: true}
}
