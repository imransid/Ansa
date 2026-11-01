package knowledge

import (
	"strings"
	"testing"
)

func TestTheCallAnswerIsOneEscapedLine(t *testing.T) {
	answer := BuildCallAnswer([]Hit{
		{ArticleID: "a", Title: "Refunds <now>", Text: "Refunds take 5 days.\nThey arrive on your card."},
		{ArticleID: "a", Title: "Refunds <now>", Text: "Ask us & we help."},
	})
	want := CallAnswerPrefix + `<article title="Refunds &lt;now&gt;">Refunds take 5 days. They arrive on your card.</article> <article title="Refunds &lt;now&gt;">Ask us &amp; we help.</article>`
	if answer.Text != want || answer.HitCount != 2 || len(answer.ArticleIDs) != 1 {
		t.Fatalf("answer: %+v", answer)
	}
	if strings.Contains(answer.Text, "\n") {
		t.Fatal("Vapi refuses line breaks")
	}
	if nothing := BuildCallAnswer(nil); nothing.Text != NothingFoundAnswer || nothing.HitCount != 0 || nothing.ArticleIDs == nil {
		t.Fatalf("nothing found: %+v", nothing)
	}
}

func TestALongPieceIsCutAfterASentence(t *testing.T) {
	long := strings.Repeat("Our shop opens at nine every day. ", 60)
	answer := BuildCallAnswer([]Hit{{ArticleID: "a", Title: "Hours", Text: long}, {ArticleID: "b", Title: "More", Text: "never reached"}})
	if utf16Length(answer.Text) > callAnswerMaxCharacters || answer.HitCount != 1 || len(answer.ArticleIDs) != 1 {
		t.Fatalf("cut answer: %d %+v", utf16Length(answer.Text), answer.ArticleIDs)
	}
	if !strings.HasSuffix(answer.Text, "every day. ...</article>") {
		t.Fatalf("cut after a sentence: %q", answer.Text[len(answer.Text)-60:])
	}
}
