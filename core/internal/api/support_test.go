package api

import (
	"encoding/base64"
	"testing"

	"ansa/core/internal/files"
)

func TestTheSupportPageAndDocumentsThroughCoresAPI(t *testing.T) {
	w := newAPIWorld(t)
	w.api.Files = &files.Store{DevFolder: t.TempDir()}
	w.api.EmailFrom = "hello@ansa.test"
	if code, answer := w.call("POST", "/api/v1/settings/support/addresses", `{"address":"x@inbound.ansa.test"}`, screensSecret, w.cookie); code != 400 || answer["fields"] == nil {
		t.Fatalf("one of ansa's own addresses: %d %v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/settings/support/addresses", `{"address":" Help@Luigis.Example "}`, screensSecret, w.cookie); code != 200 {
		t.Fatalf("add: %d", code)
	}
	if code, _ := w.call("POST", "/api/v1/settings/support/addresses", `{"address":"help@luigis.example"}`, screensSecret, w.cookie); code != 400 {
		t.Fatalf("listed already: %d", code)
	}
	if code, _ := w.call("POST", "/api/v1/settings/support/reply-to", `{"replyToEmail":"hello@ansa.test"}`, screensSecret, w.cookie); code != 400 {
		t.Fatalf("ansa's sending address is never a reply-to: %d", code)
	}
	w.call("POST", "/api/v1/settings/support/reply-to", `{"replyToEmail":"team@luigis.example"}`, screensSecret, w.cookie)
	upload := `{"fileName":"menu.exe","data":"` + base64.StdEncoding.EncodeToString([]byte("MZ")) + `"}`
	if code, _ := w.call("POST", "/api/v1/documents", upload, screensSecret, w.cookie); code != 400 {
		t.Fatalf("only plain document types: %d", code)
	}
	upload = `{"fileName":"Menu\nnotes.txt","data":"` + base64.StdEncoding.EncodeToString([]byte("Pizza")) + `"}`
	if code, _ := w.call("POST", "/api/v1/documents", upload, screensSecret, w.cookie); code != 200 {
		t.Fatalf("upload: %d", code)
	}
	_, answer := w.call("GET", "/api/v1/settings/support", "", screensSecret, w.cookie)
	overview := answer["overview"].(map[string]any)
	list := answer["documents"].([]any)
	if overview["replyToEmail"] != "team@luigis.example" || len(overview["supportAddresses"].([]any)) != 1 || len(list) != 1 {
		t.Fatalf("page: %v", answer)
	}
	document := list[0].(map[string]any)
	if document["fileName"] != "Menunotes.txt" || document["contentType"] != "text/plain" {
		t.Fatalf("a plain name and the stored type: %v", document)
	}
	id := document["id"].(string)
	_, answer = w.call("GET", "/api/v1/documents/"+id+"/download", "", screensSecret, w.cookie)
	if data, _ := base64.StdEncoding.DecodeString(answer["data"].(string)); string(data) != "Pizza" {
		t.Fatalf("download: %v", answer)
	}
	if code, _ := w.call("POST", "/api/v1/documents/"+id+"/delete", "", screensSecret, w.cookie); code != 200 {
		t.Fatalf("delete: %d", code)
	}
	if code, _ := w.call("GET", "/api/v1/documents/"+id+"/download", "", screensSecret, w.cookie); code != 404 {
		t.Fatalf("gone: %d", code)
	}
}
