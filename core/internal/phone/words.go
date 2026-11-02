package phone

import "ansa/core/internal/assistant"

// DidntCatchText is ansa's answer when nothing could be made out.
const DidntCatchText = "Sorry, I didn't catch that. Could you say it again?"

// Greeting is what ansa says when it picks up: who it is (the AI label: it
// never pretends to be the person), and whether it can help or, when it may
// not answer itself (paused, a person handling the conversation, a request
// already open), only take a message.
func Greeting(kind, name string, mayAnswer bool) string {
	hello := "Hello! " + assistant.AILabel(name, kind)
	if kind == "personal" {
		who := name
		if who == "" {
			who = "The person you called"
		}
		if mayAnswer {
			return hello + " " + who + " can't take your call right now. How can I help?"
		}
		return hello + " " + who + " can't take your call right now: please tell me your message and I'll pass it on."
	}
	if mayAnswer {
		return hello + " How can I help you?"
	}
	return hello + " Nobody can take your call right now: please tell me your message and we'll get back to you."
}
