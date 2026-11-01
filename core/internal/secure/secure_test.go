package secure

import (
	"strings"
	"testing"
)

const testKey = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="

// A value written by Node's crypto exactly as the old lib/encryption.ts does.
const fromOldBackend = "v1:Jobw8h6gm8/XltfA:eWZH2RaB4/OEqSFenLRpdQ==:GxyxJ89fMrqJReOB7zEqZG/1tjKvm8effJkumwFBea+t"

const oldContext = "conversation-message:company-a:message-1"

func newTestBox(t *testing.T) *Box {
	t.Helper()
	box, err := NewBox(testKey)
	if err != nil {
		t.Fatalf("NewBox: %v", err)
	}
	return box
}

func TestReadsWhatTheOldBackendWrote(t *testing.T) {
	plain, err := newTestBox(t).Decrypt(fromOldBackend, oldContext)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if plain != "Hello, are you open tonight? 🍕" {
		t.Fatalf("got %q", plain)
	}
}

func TestRoundTripAndAFreshIVEachTime(t *testing.T) {
	box := newTestBox(t)
	first, _ := box.Encrypt("secret", "ctx")
	second, _ := box.Encrypt("secret", "ctx")
	if first == second {
		t.Fatal("two encryptions of the same text must differ")
	}
	if !strings.HasPrefix(first, "v1:") {
		t.Fatalf("unexpected format %q", first)
	}
	plain, err := box.Decrypt(first, "ctx")
	if err != nil || plain != "secret" {
		t.Fatalf("round trip: %q, %v", plain, err)
	}
}

func TestAnotherContextOrChangedDataIsUnreadable(t *testing.T) {
	box := newTestBox(t)
	stored, _ := box.Encrypt("secret", "company-a:message-1")
	if _, err := box.Decrypt(stored, "company-b:message-1"); err != ErrUnreadable {
		t.Fatalf("another company's context must fail, got %v", err)
	}
	parts := strings.Split(stored, ":")
	parts[3] = "AAAA" + parts[3][4:]
	if _, err := box.Decrypt(strings.Join(parts, ":"), "company-a:message-1"); err != ErrUnreadable {
		t.Fatalf("changed data must fail, got %v", err)
	}
}

func TestAShortTagOrUnknownFormatIsRefused(t *testing.T) {
	box := newTestBox(t)
	parts := strings.Split(fromOldBackend, ":")
	shortTag := strings.Join([]string{parts[0], parts[1], "eWZH2RaB4/OE", parts[3]}, ":")
	for _, stored := range []string{shortTag, "v2:" + strings.Join(parts[1:], ":"), "nonsense", ""} {
		if _, err := box.Decrypt(stored, oldContext); err != ErrUnreadable {
			t.Fatalf("%q must be refused, got %v", stored, err)
		}
	}
}

func TestNewBoxRefusesAWrongKey(t *testing.T) {
	for _, key := range []string{"", "not base64!", "c2hvcnQ="} {
		if _, err := NewBox(key); err == nil {
			t.Fatalf("key %q must be refused", key)
		}
	}
}
