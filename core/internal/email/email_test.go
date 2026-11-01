package email

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTheSenderNameCanNeverPoseAsAnAddress(t *testing.T) {
	s := &Sender{FromAddress: "hello@ansa.example"}
	cases := map[string]string{
		"Luigi's":               `"Luigi's via ansa" <hello@ansa.example>`,
		"security＠bank.com":     `"security bank.com via ansa" <hello@ansa.example>`,
		`Evil" <boss@x.com>`:    `"Evil boss x.com via ansa" <hello@ansa.example>`,
		"=?UTF-8?Q?a=40b.com?=": `"UTF-8?Q?a=40b.com via ansa" <hello@ansa.example>`,
		"@@@":                   `"ansa" <hello@ansa.example>`,
		"Line\nbreak\u202eexe.jpg":   `"Line breakexe.jpg via ansa" <hello@ansa.example>`,
	}
	for name, want := range cases {
		if got := s.FromHeader(name); got != want {
			t.Errorf("FromHeader(%q) = %s, want %s", name, got, want)
		}
	}
}

func TestTheDevOutboxWritesAFileAndSendsNothing(t *testing.T) {
	folder := t.TempDir()
	s := &Sender{DevFolder: folder}
	result := s.Send(context.Background(), Message{From: s.AccountFromHeader(), To: "ana@example.com", Subject: "<b>Hi</b>", HTML: "<p>Hi</p>", Text: "Hi", IdempotencyKey: "alert-1/../x"})
	files, _ := os.ReadDir(filepath.Join(folder, ".dev-emails"))
	if !result.OK || len(files) != 1 || strings.Contains(files[0].Name(), "/") {
		t.Fatalf("result %+v, files %v", result, files)
	}
	page, _ := os.ReadFile(filepath.Join(folder, ".dev-emails", files[0].Name()))
	if !strings.Contains(string(page), "&lt;b&gt;Hi&lt;/b&gt;") || !strings.Contains(string(page), "NOT sent") {
		t.Fatal("the header fields are escaped and the page says it wasn't sent")
	}
}

func TestResendGetsTheKeyAndOnlyItsCodeIsKept(t *testing.T) {
	var seen *http.Request
	var body string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = r
		b, _ := io.ReadAll(r.Body)
		body = string(b)
		if strings.Contains(body, "refuse") {
			w.WriteHeader(422)
			io.WriteString(w, `{"name":"validation_error","message":"You can only send to ana@example.com"}`)
			return
		}
		io.WriteString(w, `{"id":"re_123"}`)
	}))
	defer server.Close()
	s := &Sender{Real: true, ResendKey: "re_key", ResendURL: server.URL, FromAddress: "hello@ansa.example"}
	ok := s.Send(context.Background(), Message{From: "x", To: "ana@example.com", Subject: "s", Text: "t", IdempotencyKey: "k1"})
	if !ok.OK || ok.ProviderID != "re_123" || seen.Header.Get("Idempotency-Key") != "k1" || seen.Header.Get("Authorization") != "Bearer re_key" {
		t.Fatalf("sent: %+v", ok)
	}
	refused := s.Send(context.Background(), Message{From: "x", To: "ana@example.com", Subject: "refuse", IdempotencyKey: "k2"})
	if refused.OK || refused.Error != "validation_error" {
		t.Fatalf("refused: %+v", refused)
	}
}
