package contentrules

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

// testdata/old_rules.json was made by running the OLD TypeScript rules
// (lib/content-rules.ts and lib/content-studio/) on these inputs: the Go
// port must give the same answers, so the browser's live checks and core's
// approvals agree.
type oldRules struct {
	Measures []struct {
		Text                 string
		X, Characters, Bytes int
	}
	Cleaning []struct {
		Text, Line, Lines, Cut string
		TooMany                bool
	}
	Typed []struct {
		Text              string
		Hashtags, Invalid []string
	}
	Model []struct {
		Tags, Kept []string
	}
	Issues []struct {
		Draft struct {
			Platform, Format, Title, Body, CallToAction, VideoScript string
			Hashtags                                                 []string
		}
		Media  *Media
		Words  []string
		Issues []Issue
	}
}

func readOldRules(t *testing.T) oldRules {
	t.Helper()
	raw, err := os.ReadFile("testdata/old_rules.json")
	if err != nil {
		t.Fatalf("reading the vectors: %v", err)
	}
	var vectors oldRules
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatalf("reading the vectors: %v", err)
	}
	return vectors
}

func TestTextsAreCountedAsTheOldRulesCountedThem(t *testing.T) {
	for _, v := range readOldRules(t).Measures {
		got := [3]int{MeasureText(v.Text, CountingX), MeasureText(v.Text, CountingCharacters), MeasureText(v.Text, CountingUTF8Bytes)}
		if want := [3]int{v.X, v.Characters, v.Bytes}; got != want {
			t.Errorf("%q: x, characters, bytes = %v, want %v", v.Text, got, want)
		}
	}
}

func TestDraftTextsAreCleanedAsTheOldRulesCleanedThem(t *testing.T) {
	for _, v := range readOldRules(t).Cleaning {
		if got := CleanDraftLine(v.Text); got != v.Line {
			t.Errorf("line %q: %q, want %q", v.Text, got, v.Line)
		}
		if got := CleanDraftLines(v.Text); got != v.Lines {
			t.Errorf("lines %q: %q, want %q", v.Text, got, v.Lines)
		}
		if got := CutRunsOfMarks(v.Text); got != v.Cut {
			t.Errorf("cut %q: %q, want %q", v.Text, got, v.Cut)
		}
		if got := HasTooManyMarksInARow(v.Text); got != v.TooMany {
			t.Errorf("too many marks %q: %v, want %v", v.Text, got, v.TooMany)
		}
	}
}

func TestHashtagsAreReadAsTheOldRulesReadThem(t *testing.T) {
	vectors := readOldRules(t)
	for _, v := range vectors.Typed {
		hashtags, invalid := ReadTypedHashtags(v.Text)
		if !sameList(hashtags, v.Hashtags) || !sameList(invalid, v.Invalid) {
			t.Errorf("typed %q: %v %v, want %v %v", v.Text, hashtags, invalid, v.Hashtags, v.Invalid)
		}
	}
	for _, v := range vectors.Model {
		if got := CleanModelHashtags(v.Tags); !sameList(got, v.Kept) {
			t.Errorf("model %v: %v, want %v", v.Tags, got, v.Kept)
		}
	}
}

func TestDraftsGetTheOldRulesIssuesWordForWord(t *testing.T) {
	for _, v := range readOldRules(t).Issues {
		d := Draft{Platform: v.Draft.Platform, Format: v.Draft.Format, Title: v.Draft.Title, Body: v.Draft.Body,
			CallToAction: v.Draft.CallToAction, VideoScript: v.Draft.VideoScript, Hashtags: v.Draft.Hashtags}
		got := CheckDraft(d, v.Media, v.Words)
		if len(got) == 0 && len(v.Issues) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, v.Issues) {
			t.Errorf("%s %s: \n got %+v\nwant %+v", d.Platform, d.Format, got, v.Issues)
		}
	}
}

func sameList(a, b []string) bool {
	return len(a) == len(b) && (len(a) == 0 || reflect.DeepEqual(a, b))
}
