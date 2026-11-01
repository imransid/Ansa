package documents

import "testing"

func TestOnlyPlainDocumentsOfUpTo4MBAreTaken(t *testing.T) {
	cases := []struct {
		name, wantType, wantProblem string
		size                        int
	}{
		{"Menu.PDF", "application/pdf", "", 10},
		{"notes.md", "text/markdown", "", 10},
		{"script.exe", "", WrongType, 10},
		{"noextension", "", WrongType, 10},
		{"big.txt", "", TooBig, MaxBytes + 1},
		{"empty.txt", "", Empty, 0},
	}
	for _, c := range cases {
		_, contentType, problem := Check(c.name, c.size)
		if contentType != c.wantType || problem != c.wantProblem {
			t.Errorf("%s: %q %q", c.name, contentType, problem)
		}
	}
	if shownName("a\x00b\nc.txt", "txt") != "abc.txt" || shownName("\n", "pdf") != "document.pdf" {
		t.Error("a plain name, or one made up")
	}
}
