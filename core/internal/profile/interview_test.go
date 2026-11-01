package profile

import (
	"context"
	"strings"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// answerLikeThePage answers as the page would: naming the opening question
// while the interview has none.
func answerLikeThePage(t *testing.T, w *world, answer string) AnswerResult {
	t.Helper()
	ctx := context.Background()
	interview, err := w.service.ReadInterview(ctx, w.company)
	if err != nil {
		t.Fatalf("reading the interview: %v", err)
	}
	var opening *string
	if interview.Opening != nil {
		topic := ""
		if interview.Opening.Topic != nil {
			topic = *interview.Opening.Topic
		}
		opening = &topic
	}
	result, err := w.service.Answer(ctx, w.company, w.owner, answer, opening)
	if err != nil {
		t.Fatalf("answering: %v", err)
	}
	return result
}

func TestTheFirstAnswerSavesTheOpeningTheAnswerAndTheReplyWithItsProposals(t *testing.T) {
	w := newWorld(t)
	w.reply(`{"kind":"ok","proposed_facts":[{"topic":"company_name","value":"Luigi's"},{"topic":"nope","value":"x"}],"next_question":"What do you sell?","interview_complete":false}`)
	result := answerLikeThePage(t, w, "We are Luigi's.")
	if result.Outcome != Saved || !result.AIReadAnswer || len(result.ProposedTopics) != 1 || result.ProposedTopics[0].Label != "Business name" {
		t.Fatalf("result: %+v", result)
	}
	interview, _ := w.service.ReadInterview(context.Background(), w.company)
	texts := []string{}
	for _, message := range interview.Messages {
		texts = append(texts, message.Author+": "+*message.Text)
	}
	if len(texts) != 3 || !strings.HasPrefix(texts[0], "assistant: Hi! I'm your AI Co-Founder.") || !strings.HasSuffix(texts[0], Topics[0].Question) ||
		texts[1] != "owner: We are Luigi's." || texts[2] != "assistant: What do you sell?" || interview.Opening != nil || interview.Finished {
		t.Fatalf("messages: %v", texts)
	}
	if w.facts()["company_name"] != (Values{Proposed: "Luigi's"}) {
		t.Fatal("the fact became a proposal")
	}
	asked := w.lastAsked()
	if asked["path"] != interviewTurnPath || len(asked["topics"].([]any)) != 25 || len(asked["messages"].([]any)) != 2 {
		t.Fatalf("the brain got: %v", asked)
	}
}

func TestWithoutAUsableAnswerTheAnswerStaysAndTheFixedQuestionComes(t *testing.T) {
	w := newWorld(t)
	result := answerLikeThePage(t, w, "We bake.")
	if result.Outcome != Saved || result.AIReadAnswer || result.FixedQuestionTopic == nil || result.FixedQuestionTopic.Topic != "company_name" {
		t.Fatalf("result: %+v", result)
	}
	interview, _ := w.service.ReadInterview(context.Background(), w.company)
	last := *interview.Messages[len(interview.Messages)-1].Text
	if last != CouldNotReadNote+" "+Topics[0].Question || len(w.facts()) != 0 {
		t.Fatalf("reply: %q", last)
	}
}

func TestTheAIEndsTheInterviewOnlyWhenNoKeyTopicIsMissing(t *testing.T) {
	w := newWorld(t)
	w.reply(`{"kind":"ok","proposed_facts":[],"next_question":"Thanks!","interview_complete":true}`)
	if result := answerLikeThePage(t, w, "That's all."); result.FixedQuestionTopic == nil || result.FixedQuestionTopic.Topic != "company_name" {
		t.Fatalf("ended too early: %+v", result)
	}
	for _, topic := range KeyTopics() {
		SaveValue(context.Background(), w.pool, w.company, w.owner, topic.Key, "", "Known")
	}
	saveProposals(t, w, []Proposal{{Topic: "goals", Value: "More regulars"}}, SourceInterview)
	w.reply(`{"kind":"ok","proposed_facts":[],"next_question":"Thanks, confirm the proposals.","interview_complete":true}`)
	answerLikeThePage(t, w, "Nothing else.")
	if interview, _ := w.service.ReadInterview(context.Background(), w.company); !interview.Finished {
		t.Fatal("the interview should be finished")
	}
	w.must(`UPDATE business_facts SET confirmed_value = NULL, confirmed_source = NULL, confirmed_by_user_id = NULL, confirmed_at = NULL WHERE company_id = $1 AND topic = 'goals'`, w.company.String())
	Dismiss(context.Background(), w.pool, w.company, w.owner, "goals", "More regulars")
	if interview, _ := w.service.ReadInterview(context.Background(), w.company); interview.Finished {
		t.Fatal("a key topic missing again opens the interview again")
	}
}

func TestTheBrainGetsOnlyTheNewest12MessagesAndMessagesAreEncrypted(t *testing.T) {
	w := newWorld(t)
	for index := range 8 {
		w.reply(`{"kind":"ok","proposed_facts":[],"next_question":"And then?","interview_complete":false}`)
		answerLikeThePage(t, w, "Answer "+string(rune('A'+index)))
	}
	// The newest 12 of 16 messages: the opening and answers A and B are left out.
	messages := w.lastAsked()["messages"].([]any)
	texts := []string{}
	for _, message := range messages {
		texts = append(texts, message.(map[string]any)["text"].(string))
	}
	joined := strings.Join(texts, "|")
	if len(texts) != 12 || strings.Contains(joined, "Answer A") || strings.Contains(joined, "Answer B") || !strings.Contains(joined, "Answer C") || texts[11] != "Answer H" {
		t.Fatalf("the brain read: %v", texts)
	}
	var id, body string
	w.pool.QueryRow(context.Background(), `SELECT id, body_encrypted FROM onboarding_messages WHERE company_id = $1 AND author = 'owner' ORDER BY created_at LIMIT 1`, w.company.String()).Scan(&id, &body)
	if !strings.HasPrefix(body, "v1:") || strings.Contains(body, "Answer A") {
		t.Fatalf("stored in plain text: %q", body)
	}
	if text, err := w.service.Box.Decrypt(body, MessageContext(w.company, id)); err != nil || text != "Answer A" {
		t.Fatal("the context names the company and the message")
	}
	pool := database.ForTest(t)
	other, _ := tenant.FromTrustedSource(database.TestCompany(t, pool))
	w.must(`INSERT INTO onboarding_messages (id, company_id, author, author_user_id, body_encrypted, ends_interview) VALUES (gen_random_uuid(), $1, 'assistant', NULL, $2, false)`, other.String(), body)
	copied, _ := w.service.ReadInterview(context.Background(), other)
	if len(copied.Messages) != 1 || !copied.Messages[0].Unreadable || copied.Messages[0].Text != nil {
		t.Fatalf("a copy in another company read: %+v", copied.Messages)
	}
}

func TestStartOverAndMembers(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	w.reply(`{"kind":"ok","proposed_facts":[{"topic":"industry","value":"Bakery"}],"next_question":"And?","interview_complete":false}`)
	answerLikeThePage(t, w, "A bakery.")
	if result, _ := w.service.Answer(ctx, w.company, w.member(), "Me too.", nil); result.Outcome != NotAllowed {
		t.Fatalf("a member answered: %s", result.Outcome)
	}
	if outcome, _ := w.service.StartOver(ctx, w.company, w.owner); outcome != Changed {
		t.Fatalf("start over: %s", outcome)
	}
	if w.count(`SELECT count(*) FROM onboarding_messages WHERE company_id = $1`) != 0 || w.facts()["industry"].Proposed != "Bakery" {
		t.Fatal("Start over deletes the messages, never the facts")
	}
	if result, _ := w.service.Answer(ctx, w.company, w.owner, "Late answer.", nil); result.Outcome != StartedOver {
		t.Fatalf("an answer to a conversation started over meanwhile: %s", result.Outcome)
	}
	reply, _ := w.service.newMessage(w.company, "Lone question?")
	if _, outcome, _ := SaveReply(ctx, w.pool, w.company, w.owner, "00000000-0000-4000-8000-000000000000", *reply, false, nil); outcome != StartedOver {
		t.Fatalf("a reply whose answer is gone: %s", outcome)
	}
	if w.count(`SELECT count(*) FROM onboarding_messages WHERE company_id = $1`) != 0 {
		t.Fatal("a reply was left behind")
	}
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, w.company.String(), w.owner)
	if outcome, _ := w.service.StartOver(ctx, w.company, w.owner); outcome != NotAllowed {
		t.Fatalf("an owner made a member started over: %s", outcome)
	}
}
