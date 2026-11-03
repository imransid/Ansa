package messenger

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

func feed(pageID string, values ...string) string {
	var changes []string
	for _, value := range values {
		changes = append(changes, `{"field":"feed","value":`+value+`}`)
	}
	return fmt.Sprintf(`{"object":"page","entry":[{"id":"%s","time":1,"changes":[%s]}]}`, pageID, strings.Join(changes, ","))
}

func commentValue(verb, commentID, fromID, parentID, extra string) string {
	return fmt.Sprintf(`{"item":"comment","verb":"%s","post_id":"111_222","comment_id":"%s","parent_id":"%s","from":{"id":"%s","name":"Lena\nMoretti"},"message":"Do you deliver?","created_time":1762250000%s}`,
		verb, commentID, parentID, fromID, extra)
}

// Only a new comment is read: an edit, a removal, a reaction or a post is
// left out; a new comment in a shape ansa doesn't read refuses the body.
func TestCommentEventsAreReadStrictly(t *testing.T) {
	body := feed("111",
		commentValue("add", "222_1", "4242", "111_222", ""),
		commentValue("edited", "222_2", "4242", "111_222", ""),
		commentValue("remove", "222_3", "4242", "111_222", ""),
		`{"item":"reaction","verb":"add","post_id":"111_222","reaction_type":"like"}`,
		commentValue("add", "222_4", "111", "222_1", `,"photo":"https://example.com/p.jpg"`),
	)
	events, err := ParseCommentEvents([]byte(body))
	if err != nil || len(events) != 2 {
		t.Fatalf("two new comments: %+v %v", events, err)
	}
	first := events[0]
	if first.PageID != "111" || first.PostID != "111_222" || first.CommentID != "222_1" || first.FromID != "4242" || !first.OnThePost() ||
		first.CreatedAt != time.Unix(1762250000, 0).UTC() || first.Describe() != "Do you deliver?" {
		t.Fatalf("the comment: %+v", first)
	}
	if events[1].OnThePost() || events[1].Describe() != "Do you deliver?\n[A photo: open Facebook to see it]" {
		t.Fatalf("a reply inside a thread, with a photo named: %+v", events[1])
	}
	for _, bad := range []string{
		feed("111", commentValue("add", "not an id", "4242", "111_222", "")),
		feed("111", strings.Replace(commentValue("add", "222_1", "4242", "111_222", ""), `"created_time":1762250000`, `"created_time":"soon"`, 1)),
		`{"object":"user","entry":[]}`,
		`not json`,
	} {
		if _, err := ParseCommentEvents([]byte(bad)); err != ErrNotForAnsa {
			t.Fatalf("%s: %v", bad, err)
		}
	}
	if events, _ := ParseCommentEvents([]byte(feed("111", strings.Replace(commentValue("add", "222_1", "4242", "", ""), `1762250000`, `"2026-11-04T10:00:00+0000"`, 1)))); len(events) != 1 ||
		events[0].CreatedAt != time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC) || !events[0].OnThePost() {
		t.Fatalf("Meta's written time, and no parent: %+v", events)
	}
	if messages, err := ParseEvents([]byte(body)); err != nil || len(messages) != 0 {
		t.Fatal("a feed body holds no message")
	}
}

// savedComments records what the webhook hands over.
type savedComments struct {
	companies []tenant.CompanyID
	events    []CommentEvent
}

func (s *savedComments) SaveComment(_ context.Context, company tenant.CompanyID, _ string, event CommentEvent) error {
	s.companies = append(s.companies, company)
	s.events = append(s.events, event)
	return nil
}

// A comment reaches the comments module only with Meta's signature, and
// only for the one company that has the Page connected.
func TestTheWebhookHandsCommentsOnForThePagesCompany(t *testing.T) {
	w := newPageWorld(t)
	saver := &savedComments{}
	w.hook.Comments = saver
	body := feed(w.pageID, commentValue("add", "222_1", "4242", "", ""))
	if w.post("sha256=00", body) != 401 || len(saver.events) != 0 {
		t.Fatal("nothing before the signature")
	}
	if w.post(sign(body), body) != 200 || len(saver.events) != 1 || saver.companies[0] != w.company {
		t.Fatalf("handed on for the Page's company: %+v", saver)
	}
	second := database.TestCompany(t, w.pool)
	w.connectPage(t, second, database.TestOwner(t, w.pool, second))
	w.post(sign(body), body)
	if len(saver.events) != 1 {
		t.Fatal("a Page connected in two companies decides nothing")
	}
}

// The public reply, the private reply and the post's text through a fake
// Graph API: the Page's token with its proof, Meta's ids read, its words never.
func TestCommentCallsThroughAFakeGraph(t *testing.T) {
	var bodies []map[string]any
	graph := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("appsecret_proof") != AppSecretProof("page-token", appSecret) {
			rw.WriteHeader(400)
			return
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		bodies = append(bodies, body)
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/111_222":
			io.WriteString(rw, `{"message":"Today's special: Kacchi","id":"111_222"}`)
		case r.URL.Path == "/222_1/comments":
			io.WriteString(rw, `{"id":"222_9"}`)
		case r.URL.Path == "/111/messages" && strings.Contains(fmt.Sprint(body["recipient"]), "222_old"):
			rw.WriteHeader(400)
			io.WriteString(rw, `{"error":{"code":10,"error_subcode":2018278,"message":"secret words"}}`)
		case r.URL.Path == "/111/messages":
			io.WriteString(rw, `{"recipient_id":"5151","message_id":"m.77"}`)
		default:
			rw.WriteHeader(500)
		}
	}))
	defer graph.Close()
	old := GraphURL
	GraphURL = graph.URL
	defer func() { GraphURL = old }()
	ctx := context.Background()
	if got := ReplyUnderComment(ctx, appSecret, "222_1", "page-token", "Yes, we do!"); got.Status != "sent" || got.ChannelMessageID != "222_9" || bodies[0]["message"] != "Yes, we do!" {
		t.Fatalf("public reply: %+v %v", got, bodies)
	}
	got := SendPrivateReply(ctx, appSecret, "111", "page-token", "222_1", strings.Repeat("word ", 500))
	recipient, _ := bodies[1]["recipient"].(map[string]any)
	if got.Status != "sent" || got.RecipientID != "5151" || got.ChannelMessageID != "m.77" || recipient["comment_id"] != "222_1" || len([]rune(bodies[1]["message"].(map[string]any)["text"].(string))) != TextMax {
		t.Fatalf("private reply, one message cut to Meta's longest: %+v %v", got, bodies[1])
	}
	if late := SendPrivateReply(ctx, appSecret, "111", "page-token", "222_old", "Hi"); late.Status != "failed" || late.Error != "reply_window_closed" {
		t.Fatalf("past the 7 days: %+v", late)
	}
	if text := PostText(ctx, appSecret, "111_222", "page-token", 10); text != "Today's sp" {
		t.Fatalf("the post's text, cut: %q", text)
	}
	if lost := ReplyUnderComment(ctx, appSecret, "999", "page-token", "Hi"); lost.Status != "unclear" {
		t.Fatalf("a 5xx may have worked: %+v", lost)
	}
}
