package knowledge

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/logging"
)

// fakeBrain answers every request with status and body (a stopped one
// answers nothing at all). Never the real brain.
func fakeBrain(t *testing.T, status int, body string, stopped bool) *brainclient.Client {
	brain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		io.WriteString(w, body)
	}))
	t.Cleanup(brain.Close)
	if stopped {
		brain.Close()
	}
	return brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second)
}

// A brain that is stopped, restarting or too slow says nothing about the
// file: the owner is told to try again, not that the file may be damaged,
// and the log says why with the error's type only.
func TestAPDFTheBrainCantReadRightNowIsNotCalledDamaged(t *testing.T) {
	file := []byte("%PDF-1.7 the shop's refund policy")
	cases := map[string]struct {
		brain  *brainclient.Client
		want   string
		logged bool
	}{
		"stopped":    {fakeBrain(t, http.StatusOK, "", true), PDFReadingUnavailable, true},
		"restarting": {fakeBrain(t, http.StatusServiceUnavailable, "", false), PDFReadingUnavailable, true},
		"damaged":    {fakeBrain(t, http.StatusOK, `{"kind":"failed","reason":"unreadable"}`, false), Unreadable, false},
		"scanned":    {fakeBrain(t, http.StatusOK, `{"kind":"failed","reason":"no_text"}`, false), NoTextInFile, false},
	}
	for name, c := range cases {
		var out bytes.Buffer
		if text, problem := documentText(context.Background(), c.brain, logging.New(&out), file, "pdf"); text != "" || problem != c.want {
			t.Errorf("%s: got %q %q", name, text, problem)
		}
		line := out.String()
		if c.logged != strings.Contains(line, `"error_type":"*errors.errorString"`) {
			t.Errorf("%s: logged %q", name, line)
		}
		if strings.Contains(line, "refund") || strings.Contains(line, base64.StdEncoding.EncodeToString(file)[:12]) {
			t.Errorf("%s: the file reached the log: %s", name, line)
		}
	}
	if PDFReadingUnavailable != "Reading PDFs isn't available right now. Try again in a minute." {
		t.Errorf("words: %q", PDFReadingUnavailable)
	}
}
