package publishing

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"ansa/core/internal/messenger"
)

// fakeGraph is Facebook's Graph API on a test server: what the last
// request sent, and how it answers.
type fakeGraph struct {
	path, sourceType, sourceName string
	fields                       map[string]string
	source                       []byte
	status                       int
	body                         string
	header                       map[string]string
}

func (g *fakeGraph) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	g.path, g.fields, g.source = r.URL.Path, map[string]string{}, nil
	if reader, err := r.MultipartReader(); err == nil {
		for part, err := reader.NextPart(); err == nil; part, err = reader.NextPart() {
			data, _ := io.ReadAll(part)
			if part.FormName() == "source" {
				g.source, g.sourceType, g.sourceName = data, part.Header.Get("Content-Type"), part.FileName()
				continue
			}
			g.fields[part.FormName()] = string(data)
		}
	} else {
		r.ParseForm()
		for name := range r.PostForm {
			g.fields[name] = r.PostForm.Get(name)
		}
	}
	for name, value := range g.header {
		w.Header().Set(name, value)
	}
	w.WriteHeader(g.status)
	io.WriteString(w, g.body)
}

func withFakeGraph(t *testing.T) *fakeGraph {
	graph := &fakeGraph{status: 200, body: `{"id": "9", "post_id": "424242_9"}`}
	server := httptest.NewServer(graph)
	old := messenger.GraphURL
	messenger.GraphURL = server.URL
	t.Cleanup(func() { messenger.GraphURL = old; server.Close() })
	return graph
}

// The old adapters/facebook-posts.ts: a photo goes to the Page's /photos
// as "source" with its own type, the text as its caption, published, its
// alt text when it has one, the token and appsecret_proof; the answer's
// post_id is the post.
func TestFacebookGetsThePhotoWithItsCaptionAndAltText(t *testing.T) {
	graph := withFakeGraph(t)
	ctx := context.Background()
	photo := &OutgoingMedia{Kind: "image", ContentType: "image/png", AltText: "A loaf", Bytes: testPNG}
	result := PublishToFacebook(ctx, "app-secret", "424242", "page-token", OutgoingPost{Text: "Fresh bread", Media: photo})
	if result.Kind != "published" || result.PostID != "424242_9" || result.URL != "https://www.facebook.com/424242_9" {
		t.Fatalf("published: %+v", result)
	}
	want := map[string]string{"caption": "Fresh bread", "published": "true", "alt_text_custom": "A loaf", "access_token": "page-token",
		"appsecret_proof": messenger.AppSecretProof("page-token", "app-secret")}
	for name, value := range want {
		if graph.fields[name] != value {
			t.Fatalf("%s: %q", name, graph.fields[name])
		}
	}
	if graph.path != "/424242/photos" || string(graph.source) != string(testPNG) || graph.sourceType != "image/png" || graph.sourceName != "image" || len(graph.fields) != 5 {
		t.Fatalf("the photo: %s %s %s %v", graph.path, graph.sourceType, graph.sourceName, graph.fields)
	}
	photo.AltText = ""
	PublishToFacebook(ctx, "app-secret", "424242", "page-token", OutgoingPost{Text: "Fresh bread", Media: photo})
	if _, sent := graph.fields["alt_text_custom"]; sent {
		t.Fatal("an empty alt text was sent")
	}
	graph.body = `{"id": "424242_10"}`
	if result := PublishToFacebook(ctx, "app-secret", "424242", "page-token", OutgoingPost{Text: "Just text"}); graph.path != "/424242/feed" || result.PostID != "424242_10" || graph.fields["message"] != "Just text" {
		t.Fatalf("a text post: %s %+v %v", graph.path, result, graph.fields)
	}
}

// What Facebook can't take is refused before asking; Meta's answers mean
// what its error-handling guide says.
func TestFacebooksAnswersAndWhatItIsNeverAsked(t *testing.T) {
	graph := withFakeGraph(t)
	ctx := context.Background()
	refused := map[string]*OutgoingMedia{
		"media_type_not_accepted": {Kind: "image", ContentType: "image/webp", Bytes: testPNG},
		"media_too_large":         {Kind: "image", ContentType: "image/jpeg", Bytes: make([]byte, 10<<20+1)},
		"video_not_supported":     {Kind: "video", ContentType: "video/mp4", Bytes: testPNG},
	}
	for code, media := range refused {
		graph.path = ""
		if result := PublishToFacebook(ctx, "s", "424242", "t", OutgoingPost{Text: "x", Media: media}); result.Kind != "not_created" || result.Code != code || graph.path != "" {
			t.Fatalf("%s: %+v, asked %q", code, result, graph.path)
		}
	}
	photo := &OutgoingMedia{Kind: "image", ContentType: "image/gif", Bytes: testPNG}
	answers := []struct {
		status int
		body   string
		want   PostResult
	}{
		{400, `{"error": {"code": 190}}`, PostResult{Kind: "not_created", Code: "token_rejected"}},
		{400, `{"error": {"code": 506}}`, PostResult{Kind: "not_created", Code: "duplicate"}},
		{403, `{"error": {"code": 200}}`, PostResult{Kind: "not_created", Code: "permission_denied"}},
		{400, `{"error": {"code": 4}}`, PostResult{Kind: "not_created", Code: "rate_limited", RetryAfterSeconds: 120}},
		{500, `{"error": {"code": 2}}`, PostResult{Kind: "unclear", Code: "temporary_error"}},
		{502, `bad gateway`, PostResult{Kind: "unclear", Code: "server_error"}},
		{200, `{"id": "not an id"}`, PostResult{Kind: "unclear", Code: "no_post_id"}},
	}
	graph.header = map[string]string{"X-Business-Use-Case-Usage": `{"424242": [{"estimated_time_to_regain_access": 2}]}`}
	for _, answer := range answers {
		graph.status, graph.body = answer.status, answer.body
		if result := PublishToFacebook(ctx, "s", "424242", "t", OutgoingPost{Text: "x", Media: photo}); result != answer.want {
			t.Fatalf("%d %s: %+v", answer.status, answer.body, result)
		}
	}
	messenger.GraphURL = "http://127.0.0.1:1"
	if result := PublishToFacebook(ctx, "s", "424242", "t", OutgoingPost{Text: "x", Media: photo}); result.Kind != "unclear" || result.Code != "network_error" {
		t.Fatalf("no answer: %+v", result)
	}
	if noAnswerCode(context.DeadlineExceeded) != "timeout" {
		t.Fatal("a time limit is a timeout")
	}
}
