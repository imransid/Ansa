package contentrules

import (
	"strings"
	"testing"
)

func TestWordsToAvoidAreWholeWordsInAnyCase(t *testing.T) {
	terms := ReadWordsToAvoid("- cheap, \"best in town\"; discount!\nNone")
	if len(terms) != 4 || terms[0] != "cheap" || terms[1] != "best in town" || terms[2] != "discount" {
		t.Fatalf("terms: %q", terms)
	}
	if ReadWordsToAvoid("None.") != nil {
		t.Fatal("None. lists nothing")
	}
	found := FindWordsToAvoid("Cheap! The BEST   in town. Cheapest prices, carefree #discount", []string{"cheap", "best in town", "free", "discount"})
	if strings.Join(found, ",") != "cheap,best in town,discount" {
		t.Fatalf("found: %q", found)
	}
}

func TestFacebooksRules(t *testing.T) {
	post := Post{Body: "Fresh bread today.", CallToAction: "Come by!", Hashtags: []string{"bakery", "fresh"}}
	if PublishedText(post) != "Fresh bread today.\n\nCome by!\n\n#bakery #fresh" {
		t.Fatalf("text: %q", PublishedText(post))
	}
	if FacebookProblems(post, []string{"cheap"}) != nil {
		t.Fatal("a fine post")
	}
	post.Hashtags = make([]string, 11)
	if got := FacebookProblems(post, []string{"bread"}); len(got) != 2 {
		t.Fatalf("problems: %v", got)
	}
}
