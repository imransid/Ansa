package devices

import (
	"strings"
	"testing"
)

// A code is 8 letters of the alphabet that never holds 0, O, 1, I or L.
func TestACodeIsEightLettersPeopleCanReadAloud(t *testing.T) {
	seen := map[string]bool{}
	for range 200 {
		code, err := newPairCode()
		if err != nil {
			t.Fatal(err)
		}
		if len(code) != 8 || strings.ContainsAny(code, "0O1IL") {
			t.Fatalf("a code: %q", code)
		}
		if _, shaped := NormalizeCode(code); !shaped {
			t.Fatalf("a code made here reads as a code: %q", code)
		}
		seen[code] = true
	}
	if len(seen) < 199 {
		t.Fatalf("codes repeat: %d different of 200", len(seen))
	}
}

// The app accepts the code with or without its dash, in any case; core
// reads it the same way.
func TestACodeIsReadWithOrWithoutItsDashInAnyCase(t *testing.T) {
	for _, typed := range []string{"K7P2QM9X", "k7p2-qm9x", " K7P2-QM9X ", "k7p2 qm9x"} {
		if code, shaped := NormalizeCode(typed); !shaped || code != "K7P2QM9X" {
			t.Fatalf("%q read as %q %v", typed, code, shaped)
		}
	}
	for _, typed := range []string{"", "K7P2QM9", "K7P2QM9XY", "K0P2QM9X", "K7P2QM9!", "К7P2QM9X"} {
		if _, shaped := NormalizeCode(typed); shaped {
			t.Fatalf("%q isn't a code", typed)
		}
	}
}

// The link inside the QR code carries core's address for phones, escaped,
// and the code.
func TestTheLinkCarriesCoresAddressAndTheCode(t *testing.T) {
	link := pairLink("https://core.ansa.app", "K7P2QM9X")
	if link != "ansa://pair?u=https%3A%2F%2Fcore.ansa.app&c=K7P2QM9X" {
		t.Fatalf("the link: %q", link)
	}
}

// The QR code comes as square rows of 0 and 1, which the screens draw.
func TestTheQRCodeIsSquareRowsOfModules(t *testing.T) {
	qr, err := qrModules(pairLink("http://127.0.0.1:8080", "K7P2QM9X"))
	if err != nil {
		t.Fatal(err)
	}
	if qr.Size < 21 || len(qr.Rows) != qr.Size {
		t.Fatalf("size %d, %d rows", qr.Size, len(qr.Rows))
	}
	for _, row := range qr.Rows {
		if len(row) != qr.Size || strings.Trim(row, "01") != "" {
			t.Fatalf("a row: %q", row)
		}
	}
	// A QR code's top-left finder pattern: a dark row of 7.
	if !strings.HasPrefix(qr.Rows[0], "1111111") || !strings.HasPrefix(qr.Rows[1], "1000001") {
		t.Fatalf("no finder pattern: %q %q", qr.Rows[0], qr.Rows[1])
	}
}

// A phone's name is one plain line of 1 to 60 characters.
func TestAPhonesNameIsOnePlainLineOfAtMostSixty(t *testing.T) {
	if name := CleanName("  Rafa's\niPhone\u200b "); name != "Rafa's iPhone" {
		t.Fatalf("cleaned: %q", name)
	}
	if name := CleanName(strings.Repeat("é", 70)); len([]rune(name)) != 60 {
		t.Fatalf("cut at 60: %d", len([]rune(name)))
	}
	if CleanName(" \n\t ") != "" || PlatformKnown("windows") || !PlatformKnown("android") {
		t.Fatal("an empty name and an unknown platform are refused")
	}
}
