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

	"ansa/core/internal/brainclient"
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
	result, problem := Read(context.Background(), client, Source{Text: "Margherita 9,50"}, "EUR")
	if problem != "" || len(result.Items) != 2 || result.Dropped != 2 || result.Items[0].PriceCents != 950 || len([]rune(result.Items[1].Name)) != 120 {
		t.Fatalf("result: %+v %q", result, problem)
	}
	if sent["text"] != "Margherita 9,50" || sent["currency"] != "EUR" {
		t.Fatalf("the brain got the text and the currency: %v", sent)
	}
}
