package alerts

import (
	"strings"
	"testing"
)

// A call's alert says what happened on it: a message ansa took, or (the
// call's note) something said on a call ansa answered.
func TestACallsAlertSaysWhatHappenedOnTheCall(t *testing.T) {
	name := "Lena"
	message := NeedsYou{CustomerName: &name, ChannelLabel: "Phone", Reason: "call_message", OnACall: true, Link: "http://x/inbox/1"}.Email("Owner").Text
	if !strings.Contains(message, "They called and left a message.") || !strings.Contains(message, "ansa took their message on the call.") {
		t.Fatalf("a message taken: %s", message)
	}
	note := NeedsYou{CustomerName: &name, ChannelLabel: "Phone", Reason: "call_note", OnACall: true, Link: "http://x/inbox/1"}
	text := note.Email("Owner").Text
	if !strings.Contains(text, "Lena needs you on Phone. After their call, ansa noted something that waits for you.") ||
		!strings.Contains(text, "ansa answered their call.") || strings.Contains(text, "message") {
		t.Fatalf("the note's alert never says they left a message: %s", text)
	}
	if !strings.Contains(note.TelegramNote(), "After their call, ansa noted something that waits for you.") {
		t.Fatalf("the Telegram note too: %s", note.TelegramNote())
	}
}
