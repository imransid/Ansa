package api

import (
	"context"
	"encoding/base64"
	"net/netip"
	"testing"

	"ansa/core/internal/files"
	"ansa/core/internal/safefetch"
)

func TestTheKnowledgePageThroughCoresAPI(t *testing.T) {
	w := newAPIWorld(t)
	w.api.Files = &files.Store{DevFolder: t.TempDir()}
	w.api.WebFetcher = &safefetch.Fetcher{Resolve: func(context.Context, string) ([]netip.Addr, error) {
		return []netip.Addr{netip.MustParseAddr("10.0.0.1")}, nil
	}}
	if code, answer := w.call("POST", "/api/v1/knowledge/articles", `{"title":"","body":"x\u0007","kind":"nope","useForSupport":true,"useForMarketing":false}`, screensSecret, w.cookie); code != 400 || len(answer["fields"].(map[string]any)) != 3 {
		t.Fatalf("problems: %d %v", code, answer)
	}
	code, answer := w.call("POST", "/api/v1/knowledge/articles", `{"title":"Parking\nhours","body":"Parking is free after 6pm.\r\n","kind":"faq","useForSupport":true,"useForMarketing":false}`, screensSecret, w.cookie)
	id, _ := answer["id"].(string)
	if code != 200 || id == "" {
		t.Fatalf("write: %d %v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/knowledge/articles/"+id+"/status", `{"change":"approve","revision":7}`, screensSecret, w.cookie); code != 409 {
		t.Fatalf("a stale approval: %d", code)
	}
	if code, _ := w.call("POST", "/api/v1/knowledge/articles/"+id+"/status", `{"change":"approve","revision":1}`, screensSecret, w.cookie); code != 200 {
		t.Fatalf("approve: %d", code)
	}
	_, answer = w.call("GET", "/api/v1/knowledge/articles/"+id, "", screensSecret, w.cookie)
	article := answer["article"].(map[string]any)
	if article["title"] != "Parking hours" || article["body"] != "Parking is free after 6pm." || article["status"] != "approved" {
		t.Fatalf("article: %v", article)
	}
	_, answer = w.call("POST", "/api/v1/knowledge/test", `{"question":"Is parking free?"}`, screensSecret, w.cookie)
	if titles := answer["titles"].([]any); len(titles) != 1 || titles[0] != "Parking hours" {
		t.Fatalf("test search: %v", answer)
	}
	upload := `{"fileName":"faq.txt","data":"` + base64.StdEncoding.EncodeToString([]byte("Q: Delivery?\n\nA: Within 3 km.")) + `"}`
	w.call("POST", "/api/v1/documents", upload, screensSecret, w.cookie)
	_, page := w.call("GET", "/api/v1/settings/support", "", screensSecret, w.cookie)
	documentID := page["documents"].([]any)[0].(map[string]any)["id"].(string)
	code, answer = w.call("POST", "/api/v1/knowledge/import/document", `{"documentId":"`+documentID+`"}`, screensSecret, w.cookie)
	if code != 200 || answer["created"] != 1.0 {
		t.Fatalf("import a document: %d %v", code, answer)
	}
	code, answer = w.call("POST", "/api/v1/knowledge/import/web", `{"url":"https://intranet.example/"}`, screensSecret, w.cookie)
	if code != 400 || answer["fields"].(map[string]any)["url"] != "That address leads to a private network, so it can't be imported." {
		t.Fatalf("a private page is never fetched: %d %v", code, answer)
	}
	_, answer = w.call("GET", "/api/v1/knowledge?status=draft", "", screensSecret, w.cookie)
	if counts := answer["counts"].(map[string]any); counts["all"] != 2.0 || counts["draft"] != 1.0 || len(answer["articles"].([]any)) != 1 {
		t.Fatalf("list: %v", answer)
	}
}
