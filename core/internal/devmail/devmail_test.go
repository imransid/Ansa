package devmail

import (
	"os"
	"path/filepath"
	"testing"
)

func write(t *testing.T, folder, name, to, subject, text string) {
	t.Helper()
	page := "<!doctype html>\n<html>\n  <body>\n    <p>Dev outbox: this email was NOT sent.</p>\n" +
		"<div><strong>From:</strong> &quot;ansa&quot; &lt;hello@ansa.test&gt;</div>\n<div><strong>To:</strong> " + to + "</div>\n" +
		"<div><strong>Reply-To:</strong> (none)</div>\n<div><strong>Subject:</strong> " + subject + "</div>\n    <hr />\n    <p>html</p>\n    <hr />\n" +
		"    <pre>" + text + "</pre>\n  </body>\n</html>"
	if err := os.WriteFile(filepath.Join(folder, name), []byte(page), 0o600); err != nil {
		t.Fatal(err)
	}
}

// Only the emails kept, newest first, their text read back as written;
// other files are left out.
func TestTheMailboxReadsOnlyTheEmailsKept(t *testing.T) {
	folder := t.TempDir()
	write(t, folder, "2026-11-03T10-00-00.000Z-verify-email-AnaAccountId00000000000000000000-k.html", "Ana@X.example", "Confirm your email", "Open http://localhost:3000/verify-email#abc &amp; enter your password.")
	write(t, folder, "2026-11-03T11-00-00.000Z-ticket-solved-4f1c2d3e-0000-4000-8000-000000000001.html", "Lena &lt;lena@customer.example&gt;", "Your request #1 is solved", "Done.")
	write(t, folder, "2026-11-03T12-00-00.000Z-ticket-solved-4f1c2d3e-0000-4000-8000-000000000002.html", "someone@else.example", "Not yours", "No.")
	os.WriteFile(filepath.Join(folder, "notes.txt"), []byte("not an email"), 0o600)
	ours := map[string]bool{"AnaAccountId00000000000000000000": true, "4f1c2d3e-0000-4000-8000-000000000001": true}
	keep := func(email Mail) bool {
		for _, id := range keyIDs(email.key) {
			if ours[id] {
				return true
			}
		}
		return false
	}
	emails, err := Read(folder, keep, 10)
	if err != nil || len(emails) != 2 {
		t.Fatalf("two emails: %v %v", emails, err)
	}
	if emails[0].Subject != "Your request #1 is solved" || emails[1].Text != "Open http://localhost:3000/verify-email#abc & enter your password." || emails[1].From != `"ansa" <hello@ansa.test>` {
		t.Fatalf("newest first, read as written: %+v", emails)
	}
	if limited, _ := Read(folder, keep, 1); len(limited) != 1 {
		t.Fatal("at most the limit")
	}
	if toAna, _ := Read(folder, ToAddress("ana@x.example"), 10); len(toAna) != 1 || toAna[0].Subject != "Confirm your email" {
		t.Fatalf("to one address, whatever its case: %+v", toAna)
	}
	if none, err := Read(filepath.Join(folder, "missing"), keep, 10); err != nil || len(none) != 0 {
		t.Fatal("no folder yet: none")
	}
}

// A key's ids: its uuids and its account ids, never a kind's words.
func TestKeyIDs(t *testing.T) {
	got := keyIDs("needs-you-cf7d2f33-03c8-477b-b903-ed05f8fa2fb1-6eoG3mmLh4ExA0Kb5moNMBDgpfROim1Y")
	if len(got) != 2 || got[0] != "cf7d2f33-03c8-477b-b903-ed05f8fa2fb1" || got[1] != "6eoG3mmLh4ExA0Kb5moNMBDgpfROim1Y" {
		t.Fatalf("%q", got)
	}
	if got := keyIDs("ticket-assigned-short"); len(got) != 0 {
		t.Fatalf("no ids: %q", got)
	}
}
