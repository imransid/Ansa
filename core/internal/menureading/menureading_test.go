package menureading

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/logging"
)

func docx(t *testing.T, documentXML string) []byte {
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	part, _ := archive.Create("word/document.xml")
	part.Write([]byte(documentXML))
	archive.Close()
	return buffer.Bytes()
}

func TestAWordFilesTextIsReadAndABombStopsAtItsCap(t *testing.T) {
	text := DocxText(docx(t, `<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Margherita</w:t><w:tab/><w:t>9.50</w:t></w:r></w:p><w:p/><w:p/><w:p><w:r><w:t>Water 2</w:t></w:r></w:p></w:body></w:document>`))
	if text != "Margherita\t9.50\n\nWater 2" {
		t.Fatalf("text: %q", text)
	}
	bomb := docx(t, `<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>`+strings.Repeat("A", docxTextMaxBytes+100)+`</w:t></w:r></w:p></w:body></w:document>`)
	if got := DocxText(bomb); len(got) > docxTextMaxBytes {
		t.Fatalf("unpacked past the cap: %d", len(got))
	}
}

func TestFilesAreKnownByTheirOwnBytes(t *testing.T) {
	cases := map[string]string{"\xFF\xD8\xFF\xE0": "image/jpeg", "%PDF-1.7": "application/pdf", "RIFF0000WEBPVP8 ": "image/webp", "<svg>": ""}
	for data, want := range cases {
		if got := MediaType([]byte(data)); got != want {
			t.Errorf("%q: got %q", data, got)
		}
	}
	if _, problem := request(Source{File: []byte("<svg onload=x>"), FileName: "menu.jpg"}, "EUR"); problem != WrongFile {
		t.Fatal("a file named .jpg that isn't one is refused")
	}
	if _, problem := request(Source{File: docx(t, "<x/>"), FileName: "menu.zip"}, "EUR"); problem != WrongFile {
		t.Fatal("a zip that isn't named .docx is refused")
	}
}

// fakeBrain answers every request with status and body, and keeps what it
// was sent (a stopped one answers nothing at all). Never the real brain.
func fakeBrain(t *testing.T, status int, body string, stopped bool) (*brainclient.Client, *map[string]any) {
	sent := map[string]any{}
	brain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		request, _ := io.ReadAll(r.Body)
		json.Unmarshal(request, &sent)
		w.WriteHeader(status)
		io.WriteString(w, body)
	}))
	t.Cleanup(brain.Close)
	if stopped {
		brain.Close()
	}
	return brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second), &sent
}

// A Word menu with more text than the brain reads (20,000 characters, as
// pasted text) is cut after a whole line, and the owner is told the rest
// was left out: it was refused whole before, "ansa couldn't read this menu".
func TestALongWordMenuIsCutAfterALineAndSaysSo(t *testing.T) {
	client, sent := fakeBrain(t, http.StatusOK, `{"kind":"ok","rows":[{"category":"","name":"Kacchi","description":"","price":"450"}]}`, false)
	dish := "কাচ্চি বিরিয়ানি, হাফ প্লেট 450"
	long := `<w:document xmlns:w="x"><w:body>` + strings.Repeat(`<w:p><w:r><w:t>`+dish+`</w:t></w:r></w:p>`, 1_000) + `</w:body></w:document>`
	result, problem := Read(context.Background(), client, logging.New(io.Discard), Source{File: docx(t, long), FileName: "menu.docx"}, "BDT")
	text, _ := (*sent)["text"].(string)
	if problem != "" || !result.TextCut || utf8.RuneCountInString(text) > 20_000 || utf8.RuneCountInString(text) < 19_950 {
		t.Fatalf("cut to the brain's 20,000 characters: %q %+v, %d characters", problem, result, utf8.RuneCountInString(text))
	}
	if lines := strings.Split(text, "\n"); lines[len(lines)-1] != dish {
		t.Fatalf("cut after a whole line: %q", lines[len(lines)-1])
	}
	short, _ := Read(context.Background(), client, logging.New(io.Discard), Source{File: docx(t, `<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>`+dish+`</w:t></w:r></w:p></w:body></w:document>`), FileName: "menu.docx"}, "BDT")
	if short.TextCut || (*sent)["text"] != dish {
		t.Fatalf("a short file whole: %+v %v", short, (*sent)["text"])
	}
}

// A brain that is stopped, restarting or too slow says nothing about the
// menu: the owner is told to try again in a minute, not that the menu
// couldn't be read, and the log says why with the error's type only.
func TestAMenuTheBrainCantReadRightNowIsNotCalledUnreadable(t *testing.T) {
	stopped, _ := fakeBrain(t, http.StatusOK, "", true)
	restarting, _ := fakeBrain(t, http.StatusServiceUnavailable, "", false)
	failed, _ := fakeBrain(t, http.StatusOK, `{"kind":"failed","reason":"unreadable"}`, false)
	cases := map[string]struct {
		brain  *brainclient.Client
		want   string
		logged bool
	}{
		"stopped":    {stopped, ReadingUnavailableNow, true},
		"restarting": {restarting, ReadingUnavailableNow, true},
		"unreadable": {failed, Unreadable, false},
	}
	for name, c := range cases {
		var out bytes.Buffer
		if _, problem := Read(context.Background(), c.brain, logging.New(&out), Source{Text: "Kacchi biryani 450 taka"}, "BDT"); problem != c.want {
			t.Errorf("%s: got %q", name, problem)
		}
		line := out.String()
		if c.logged != strings.Contains(line, `"error_type":`) || strings.Contains(line, "Kacchi") {
			t.Errorf("%s: logged %q", name, line)
		}
	}
	if ReadingUnavailableNow != "Reading menus isn't available right now. Try again in a minute." {
		t.Errorf("words: %q", ReadingUnavailableNow)
	}
}

func TestCoreReadsEveryPriceItself(t *testing.T) {
	var sent map[string]any
	brain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &sent)
		io.WriteString(w, `{"kind":"ok","rows":[
			{"category":"Pizza","name":"Margherita","description":"","price":"9,50"},
			{"category":"","name":"","description":"","price":"3"},
			{"category":"","name":"`+strings.Repeat("N", 200)+`","description":"","price":"free"},
			{"category":"","name":"`+strings.Repeat("L", 200)+`","description":"","price":"4"}]}`)
	}))
	defer brain.Close()
	client := brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second)
	result, problem := Read(context.Background(), client, logging.New(io.Discard), Source{Text: "Margherita 9,50"}, "EUR")
	if problem != "" || len(result.Items) != 2 || result.Dropped != 2 || result.Items[0].PriceCents != 950 || len([]rune(result.Items[1].Name)) != 120 {
		t.Fatalf("result: %+v %q", result, problem)
	}
	if sent["text"] != "Margherita 9,50" || sent["currency"] != "EUR" {
		t.Fatalf("the brain got the text and the currency: %v", sent)
	}
}
