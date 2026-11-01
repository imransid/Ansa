package studio

import (
	"ansa/core/internal/knowledge"
	"strings"
	"testing"
)

func TestTheFormsCheckWhatAPersonTypes(t *testing.T) {
	_, problems := CheckNewDraft(NewDraftForm{Platform: "youtube", Format: "post", Topic: "  "})
	if problems["format"] != "This platform takes videos only." || problems["topic"] != "Say what the post is about." {
		t.Fatalf("YouTube takes videos only, and a topic is needed: %v", problems)
	}
	checked, problems := CheckNewDraft(NewDraftForm{Platform: "x", Format: "post", Topic: "Bread\nof the day", Pillar: "Craft"})
	if len(problems) != 0 || checked.Placement.Topic != "Bread of the day" {
		t.Fatalf("a topic is one line: %v %+v", problems, checked)
	}
	_, fields, problems := CheckEdit(EditForm{Topic: "Bread", Body: "One\r\ntwo", Hashtags: "#bread #fresh_loaf"})
	if len(problems) != 0 || fields.Body != "One\ntwo" || strings.Join(fields.Hashtags, " ") != "bread fresh_loaf" {
		t.Fatalf("line breaks as \\n, hashtags as words: %v %+v", problems, fields)
	}
	_, _, problems = CheckEdit(EditForm{Topic: "Bread", Hashtags: "#bread #not-one"})
	if !strings.HasPrefix(problems["hashtags"], "Not a hashtag: ") {
		t.Fatalf("a hashtag is one word: %v", problems)
	}
	_, _, problems = CheckEdit(EditForm{Topic: "Bread", Body: "a" + strings.Repeat("́", 31)})
	if problems["body"] != tooManyMarks {
		t.Fatalf("at most 30 marks in a row: %v", problems)
	}
	_, _, problems = CheckEdit(EditForm{Topic: "Bread", Title: strings.Repeat("😀", 51)})
	if problems["title"] != "A title can be at most 100 characters." {
		t.Fatalf("lengths count as the old code did (an emoji is 2): %v", problems)
	}
	if note, problem := CheckRejectionNote("  "); note != nil || problem != "" {
		t.Fatal("a blank note is none")
	}
}

func TestSeveralTextsAreSearchedWithTheirWordsInTurns(t *testing.T) {
	long := "sourdough rye spelt baguette brioche focaccia ciabatta croissant pretzel bagel muffin scone waffle crepe donut eclair tart pie cake cookie biscuit"
	words := strings.Fields(knowledge.CombineSearchTexts([]string{long, "christmas", ""}))
	if len(words) != 20 || words[0] != "sourdough" || words[1] != "christmas" {
		t.Fatalf("the second text's words take their turn: %v", words)
	}
}

func TestTheAIsTextsAreCutWithoutHalfAnEmoji(t *testing.T) {
	if cut := cleanModelLine(strings.Repeat("a", 99)+"😀b", 100); cut != strings.Repeat("a", 99) {
		t.Fatalf("never half an emoji: %q", cut)
	}
	if text := cleanModelLines("a\x00b\n\n\n\nc\t", 100); text != "ab\n\nc" {
		t.Fatalf("control characters out, one blank line at most: %q", text)
	}
}
