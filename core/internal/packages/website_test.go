package packages

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"testing"
)

// -update writes website.json from packages.go (make website-packages).
var updateWebsiteFile = flag.Bool("update", false, "write website.json from packages.go")

// The website's Pricing page reads website.json: it must say exactly what
// core enforces, so a price or a limit changed in packages.go alone fails here.
func TestTheWebsiteFileListsThePackages(t *testing.T) {
	want, err := json.MarshalIndent(ForWebsite(), "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	want = append(want, '\n')
	if *updateWebsiteFile {
		if err := os.WriteFile("website.json", want, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	got, err := os.ReadFile("website.json")
	if err != nil || !bytes.Equal(got, want) {
		t.Fatal("website.json doesn't match packages.go: run make website-packages (from core/), then check the Pricing page")
	}
}
