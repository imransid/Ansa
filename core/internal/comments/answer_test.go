package comments

import (
	"context"
	"strings"
	"testing"

	"ansa/core/internal/conversations"
	"ansa/core/internal/messenger"
	"ansa/core/internal/standins"
)

// A real question: the AI's short answer in public, nothing in private.
// The brain reads the business, the post and the comment, no id.
func TestAQuestionIsAnsweredInPublic(t *testing.T) {
	w := newCommentWorld(t)
	id := w.comment("q-1", "lena", "Do you deliver to Gulshan?")
	w.brainSays("question", map[string]string{"public_reply": "Sorry, Gulshan is too far for us, but you're welcome to pick up!"})
	if outcome := w.answer(id); outcome != StatusAnswered {
		t.Fatalf("outcome: %s", outcome)
	}
	view := w.view(id)
	if view.Kind != KindQuestion || view.PublicReply == nil || view.PublicReply.Status != PartSent || view.PrivateMessage != nil {
		t.Fatalf("answered in public: %+v", view)
	}
	if w.written()["facebook-comment:q-1"] != "Sorry, Gulshan is too far for us, but you're welcome to pick up!" {
		t.Fatalf("the stand-in Page's reply: %v", w.written())
	}
	asked := w.asked[0]
	if asked.Comment != "Do you deliver to Gulshan?" || asked.Business.Name != "Shapla Kitchen" || len(asked.Menu) != 1 || asked.Menu[0].Price != "BDT 450.00" && asked.Menu[0].Price != "BDT 450" {
		t.Fatalf("the brain's slice: %+v", asked)
	}
	if again := w.answer(id); again != StatusAnswered || len(w.asked) != 1 {
		t.Fatal("a retried run never decides or sends again")
	}
}

// A price question: ansa's own public note and the AI's private message
// with the AI label, which opens the commenter's Messenger conversation.
// Their answer there joins it, and the assistant carries on as in a chat.
func TestAPriceQuestionGetsANoteAndAPrivateMessageInMessenger(t *testing.T) {
	w := newCommentWorld(t)
	name := "তানিয়া"
	id := w.comment("p-1", standins.PSID(name), "দাম কত?", func(e *messenger.CommentEvent) { e.FromName = name })
	w.brainSays("order", map[string]string{"private_message": "কাচ্চি বিরিয়ানি ৳450। এখানেই অর্ডার করুন!"})
	w.answer(id)
	view := w.view(id)
	if view.Kind != KindOrder || view.PublicReply == nil || view.PrivateMessage == nil || view.PrivateMessage.ConversationID == "" {
		t.Fatalf("a note and a private message: %+v", view)
	}
	if !contains(orderNotes.Bangla, view.PublicReply.Text) {
		t.Fatalf("ansa's own note, in Bangla: %q", view.PublicReply.Text)
	}
	if !strings.HasPrefix(view.PrivateMessage.Text, "আমি Shapla Kitchen-এর এআই সহকারী।\n") || !strings.HasSuffix(view.PrivateMessage.Text, "এখানেই অর্ডার করুন!") {
		t.Fatalf("the AI label first, in the comment's language: %q", view.PrivateMessage.Text)
	}
	contact := messenger.ContactID(w.pageID, standins.PSID(name))
	if w.count(`SELECT count(*) FROM messages JOIN contacts ON contacts.company_id = messages.company_id
		JOIN conversations ON conversations.id = messages.conversation_id AND conversations.contact_id = contacts.id
		WHERE messages.company_id = $1 AND contacts.external_id = $2 AND contacts.channel = 'messenger' AND messages.author = 'assistant' AND messages.send_status = 'sent'`, contact) != 1 {
		t.Fatal("the private message is ansa's in the commenter's Messenger conversation")
	}
	messageID, _ := conversations.NewID()
	body, _ := w.box.Encrypt("২টা দিন", conversations.MessageContext(w.company, messageID))
	turn, err := conversations.InsertCustomerMessage(context.Background(), w.pool, w.company, conversations.ContactKey{Channel: conversations.ChannelMessenger, ExternalID: contact},
		conversations.IncomingMessage{ID: messageID, BodyEncrypted: body, ChannelMessageID: "m-2"})
	if err != nil || turn == nil || turn.ConversationID != view.PrivateMessage.ConversationID {
		t.Fatalf("their answer in Messenger joins that conversation: %v", err)
	}
}

// The AI writes a price that isn't on the menu: ansa's check stops it, and
// the comment is handled as unsure (a note, the holding reply in private, a
// request saying why, the owners alerted).
func TestAMadeUpPriceIsStoppedAndAPersonFollowsUp(t *testing.T) {
	w := newCommentWorld(t)
	id := w.comment("x-1", "lena", "How much is the kacchi?")
	w.brainSays("order", map[string]string{"private_message": "Kacchi Biryani is only BDT 250 today!"})
	w.answer(id)
	view := w.view(id)
	if view.Kind != KindUnsure || view.RequestNumber == 0 || view.PrivateMessage == nil || strings.Contains(view.PrivateMessage.Text, "250") {
		t.Fatalf("never sent, a person follows up: %+v", view)
	}
	if !strings.HasSuffix(view.PrivateMessage.Text, "\nThanks! Our team will get back to you soon.") || !contains(unsureNotes.English, view.PublicReply.Text) {
		t.Fatalf("the holding reply in private, a fixed note in public: %+v", view)
	}
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1 AND subject = 'Comment reply stopped: a price not on your menu' AND conversation_id IS NOT NULL`) != 1 ||
		w.count(`SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'comment.alert'`) != 1 {
		t.Fatal("the request says why, belongs to their Messenger conversation, and the owners are alerted")
	}
}

// A complaint: an apology in public, the holding reply in private, the
// AI's subject and summary on a request; praise and spam: nothing.
func TestAComplaintGoesToAPersonAndPraiseGetsNothing(t *testing.T) {
	w := newCommentWorld(t)
	id := w.comment("k-1", "sara", "My order came cold, very bad!")
	w.brainSays("complaint", map[string]string{"subject": "Cold delivery", "summary": "Sara's order arrived cold."})
	w.answer(id)
	view := w.view(id)
	if view.Kind != KindComplaint || !contains(complaintNotes.English, view.PublicReply.Text) || view.RequestNumber == 0 {
		t.Fatalf("an apology and a request: %+v", view)
	}
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1 AND subject = 'Cold delivery' AND description LIKE '%Sara''s order arrived cold.'`) != 1 {
		t.Fatal("the AI's subject and summary")
	}
	for kind, comment := range map[string]string{KindThanks: "Looks delicious 😍", KindSpam: "Cheap followers at spam.example"} {
		id := w.comment("t-"+kind, "fan-"+kind, comment)
		w.brainSays(kind, nil)
		w.answer(id)
		if view := w.view(id); view.Status != StatusSkipped || view.SkipReason != kind || view.PublicReply != nil {
			t.Fatalf("%s: %+v", kind, view)
		}
	}
	if len(w.written()) != 2 {
		t.Fatalf("only the complaint's two parts went out: %v", w.written())
	}
}

// The AI down: the commenter still hears back (a note, the holding reply)
// and a person follows up; production never answers on a stand-in Page.
func TestABrainFailureGoesToAPersonAndProductionRefusesStandIns(t *testing.T) {
	w := newCommentWorld(t)
	id := w.comment("f-1", "lena", "Can I bring my dog?")
	w.answer(id)
	if view := w.view(id); view.Kind != KindUnsure || view.RequestNumber == 0 || view.Status != StatusAnswered {
		t.Fatalf("handed to a person: %+v", view)
	}
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1 AND description LIKE '%didn''t answer in time%'`) != 1 {
		t.Fatal("the request says the AI failed")
	}
	w.answerer.StandInsAllowed = false
	other := w.comment("f-2", "marco", "Open today?")
	w.brainSays("question", map[string]string{"public_reply": "Yes, all day!"})
	w.answer(other)
	if view := w.view(other); view.Status != StatusFailed || view.PublicReply.Status != PartFailed {
		t.Fatalf("nothing goes out from a stand-in in production: %+v", view)
	}
}

func contains(list []string, wanted string) bool {
	for _, item := range list {
		if item == wanted {
			return true
		}
	}
	return false
}
