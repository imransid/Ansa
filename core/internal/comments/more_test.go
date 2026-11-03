package comments

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ansa/core/internal/assistant"
	"ansa/core/internal/messenger"
	"ansa/core/internal/orders"
	"ansa/core/internal/social"
)

// The hourly ceilings (per commenter, per business) and the package's AI
// replies: past them a comment is skipped, the brain never asked.
func TestLimitsAndThePackageSkipWithoutTheAI(t *testing.T) {
	w := newCommentWorld(t)
	w.brainSays("thanks", nil)
	for i := 0; i < 5; i++ {
		w.answer(w.comment("l-"+string(rune('a'+i)), "flood", "Nice!"))
	}
	id := w.comment("l-6", "flood", "Nice!")
	w.answer(id)
	if view := w.view(id); view.SkipReason != SkipLimit || len(w.asked) != 5 {
		t.Fatalf("the sixth comment of one person in an hour: %+v, %d asked", view, len(w.asked))
	}
	w.must(`INSERT INTO usage_months (company_id, month, ai_replies) VALUES ($1, date_trunc('month', now() AT TIME ZONE 'UTC')::date, 150)
		ON CONFLICT (company_id, month) DO UPDATE SET ai_replies = 150`, w.company.String())
	used := w.comment("u-1", "lena", "Open today?")
	w.answer(used)
	if view := w.view(used); view.SkipReason != SkipPackage || len(w.asked) != 5 {
		t.Fatalf("no AI replies left this month: %+v", view)
	}
	if w.count(`SELECT ai_replies FROM usage_months WHERE company_id = $1`) != 150 {
		t.Fatal("each comment the brain read counted once, never past the limit")
	}
}

// A run cut off after it started sending never sends again by itself:
// what it left "sending" may have gone out ("unclear").
func TestARunCutOffNeverSendsAgain(t *testing.T) {
	w := newCommentWorld(t)
	id := w.comment("z-1", "lena", "Open today?")
	w.brainSays("question", map[string]string{"public_reply": "Yes, all day!"})
	company := w.company.String()
	public, _ := w.box.Encrypt("Yes, all day!", TextContext(w.company, id, "public_reply"))
	w.must(`UPDATE page_comments SET decided_at = now(), delivery_started_at = now(), kind = 'question', public_reply_encrypted = $3, public_reply_status = 'sending'
		WHERE company_id = $1 AND id = $2`, company, id, public)
	if outcome := w.answer(id); outcome != "cut_off" || len(w.written()) != 0 {
		t.Fatalf("nothing sent again: %s %v", outcome, w.written())
	}
	if view := w.view(id); view.Status != StatusAnswered || view.PublicReply.Status != PartUnclear {
		t.Fatalf("it may have gone out: %+v", view)
	}
}

// A real Page through a fake Graph API: the post's text read with the
// Page's token, the private reply to the comment (Meta names the
// commenter's Page-scoped id: their Messenger conversation), the public
// note under it. The token and Meta's words are never kept.
func TestARealPageAnswersThroughMeta(t *testing.T) {
	w := newCommentWorld(t)
	var requests []string
	graph := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("appsecret_proof") != messenger.AppSecretProof("page-token", "app-secret") {
			rw.WriteHeader(400)
			return
		}
		body, _ := io.ReadAll(r.Body)
		requests = append(requests, r.Method+" "+r.URL.Path+" "+string(body))
		switch r.URL.Path {
		case "/424242_7":
			io.WriteString(rw, `{"message":"Kacchi Biryani today, BDT 450 a plate"}`)
		case "/424242/messages":
			io.WriteString(rw, `{"recipient_id":"9191","message_id":"m.1"}`)
		case "/7_1/comments":
			io.WriteString(rw, `{"id":"7_2"}`)
		}
	}))
	defer graph.Close()
	old := messenger.GraphURL
	messenger.GraphURL = graph.URL
	defer func() { messenger.GraphURL = old }()
	token, _ := w.box.Encrypt("page-token", social.TokenContext(w.company, w.connection, "access"))
	w.must(`UPDATE social_connections SET is_stand_in = false, external_account_id = '424242', access_token_encrypted = $2,
		scopes = ARRAY['pages_messaging', 'pages_read_user_content', 'pages_manage_engagement'] WHERE company_id = $1`, w.company.String(), token)
	w.pageID = "424242"
	w.answerer.MetaAppSecret = "app-secret"
	id := w.comment("7_1", "5555", "How much?", func(e *messenger.CommentEvent) { e.PostID, e.ParentID = "424242_7", "424242_7" })
	w.brainSays("order", map[string]string{"private_message": "Kacchi Biryani is BDT 450 a plate. Order here in Messenger!"})
	w.answer(id)
	if w.asked[0].Post != "Kacchi Biryani today, BDT 450 a plate" {
		t.Fatalf("the post's text, read from Meta: %q", w.asked[0].Post)
	}
	if len(requests) != 3 || !strings.Contains(requests[1], `"recipient":{"comment_id":"7_1"}`) || !strings.HasPrefix(requests[2], "POST /7_1/comments") {
		t.Fatalf("the private reply first, then the public note: %v", requests)
	}
	view := w.view(id)
	if view.Status != StatusAnswered || view.PrivateMessage.ConversationID == "" ||
		w.count(`SELECT count(*) FROM contacts WHERE company_id = $1 AND channel = 'messenger' AND external_id = '424242:9191'`) != 1 {
		t.Fatalf("the commenter's Messenger conversation, by the id Meta named: %+v", view)
	}
	if w.count(`SELECT count(*) FROM page_comments WHERE company_id = $1 AND public_reply_comment_id = '7_2' AND private_message_id = 'm.1'`) != 1 {
		t.Fatal("Meta's ids are kept")
	}
}

// A Page that may not send Messenger messages: the private message fails
// before Meta is asked, and the note announcing it is never posted.
func TestNoNoteWithoutItsPrivateMessage(t *testing.T) {
	w := newCommentWorld(t)
	w.must(`UPDATE social_connections SET is_stand_in = false, external_account_id = '424242',
		scopes = ARRAY['pages_read_user_content', 'pages_manage_engagement'] WHERE company_id = $1`, w.company.String())
	w.pageID = "424242"
	id := w.comment("n-1", "5555", "How much?")
	w.brainSays("order", map[string]string{"private_message": "Kacchi Biryani is BDT 450."})
	w.answer(id)
	view := w.view(id)
	if view.Status != StatusFailed || view.PrivateMessage.Status != PartFailed || view.PublicReply.Status != PartFailed {
		t.Fatalf("nothing announced that never went: %+v", view)
	}
}

// ansa's notes vary: neighbouring comments get different wordings, in the
// comment's language, and the same comment always the same one.
func TestTheNotesVaryByComment(t *testing.T) {
	seen := map[string]bool{}
	for _, id := range []string{"1_1", "1_2", "1_3", "1_4", "1_5", "1_6", "1_7", "1_8"} {
		note := pick(orderNotes, planInputs{CommentID: id})
		if note != pick(orderNotes, planInputs{CommentID: id}) || !contains(orderNotes.English, note) {
			t.Fatal("the same comment, the same note")
		}
		seen[note] = true
	}
	if len(seen) < 3 {
		t.Fatalf("eight comments, %d wordings", len(seen))
	}
	if !contains(complaintNotes.Bangla, pick(complaintNotes, planInputs{CommentID: "1_1", Language: orders.Bangla})) {
		t.Fatal("in Bangla for a Bangla comment")
	}
	for _, notes := range []fixedNotes{orderNotes, complaintNotes, unsureNotes} {
		if len(notes.English) < 5 || len(notes.Bangla) < 5 {
			t.Fatal("at least five wordings in each language")
		}
	}
}

// Core decides, never the brain: a reply too long or naming a link ansa
// doesn't know is handled as unsure; an unknown kind too.
func TestCoreDecidesWhatTheBrainProposes(t *testing.T) {
	in := planInputs{Checks: assistant.CheckData{Currency: "BDT", MenuPrices: []int64{45000}}, Name: "Shapla Kitchen", AccountKind: "business",
		HoldingReply: "We'll get back to you.", ReplyMode: "automatic", CommentID: "1_1"}
	for _, answer := range []BrainAnswer{
		{Kind: KindQuestion, PublicReply: strings.Repeat("x", PublicReplyMax+1)},
		{Kind: KindQuestion, PublicReply: "See https://unknown.example"},
		{Kind: KindOrder, PrivateMessage: "We'll refund you."},
		{Kind: "praise"},
	} {
		p := planFor(answer, in)
		if p.Kind != KindUnsure || p.Handover == nil || !strings.HasSuffix(p.Private, "\nWe'll get back to you.") || p.PublicStatus != PartSending {
			t.Errorf("%+v: %+v", answer, p)
		}
	}
	if p := planFor(BrainAnswer{Kind: KindQuestion, PublicReply: "Kacchi is BDT 450!"}, in); p.Handover != nil || p.Public != "Kacchi is BDT 450!" {
		t.Fatalf("a menu price may be said: %+v", p)
	}
	encoded, _ := json.Marshal(AlertPayload{CommentID: "x", Reason: "complaint"})
	if strings.Contains(string(encoded), "text") {
		t.Fatal("an alert's job names the comment, never its words")
	}
}
