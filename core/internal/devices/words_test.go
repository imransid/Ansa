package devices

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The app words "What ansa did" as the web Home does: the words here are
// the screens' ACTIVITY_TEXT (lib/conversations.ts), read from that file.
func TestTheAppWordsEachLineAsTheWebHomeDoes(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("..", "..", "..", "lib", "conversations.ts"))
	if err != nil {
		t.Fatalf("reading the screens' words: %v", err)
	}
	start := strings.Index(string(source), "export const ACTIVITY_TEXT")
	if start < 0 {
		t.Fatal("lib/conversations.ts has no ACTIVITY_TEXT")
	}
	block := string(source)[start:]
	block = block[:strings.Index(block, "};")]
	screens := map[string]string{}
	for _, match := range regexp.MustCompile(`(?m)^\s*([a-z_]+): "([^"]*)",?$`).FindAllStringSubmatch(block, -1) {
		screens[match[1]] = match[2]
	}
	if len(screens) != len(activityText) {
		t.Fatalf("the screens word %d actions, core %d", len(screens), len(activityText))
	}
	for action, words := range screens {
		if activityText[action] != words {
			t.Fatalf("%s: the screens say %q, core %q", action, words, activityText[action])
		}
	}
}

// A line names its customer as the web Home does.
func TestALineNamesItsCustomerAsHomeDoes(t *testing.T) {
	name := "Nabil\n"
	empty := " "
	cases := []struct {
		name    *string
		channel string
		want    string
	}{
		{&name, "telegram", "Nabil"},
		{nil, "telegram", "Telegram customer"},
		{nil, "stand_in", "Stand-in chat customer"},
		{&empty, "whatsapp", "WhatsApp customer"},
		{nil, "phone", "a customer"},
		{nil, "email", "a customer"},
	}
	for _, c := range cases {
		if got := customerLabel(c.name, c.channel); got != c.want {
			t.Fatalf("%v on %s: %q, want %q", c.name, c.channel, got, c.want)
		}
	}
}
