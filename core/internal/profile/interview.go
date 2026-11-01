package profile

import (
	"context"
	"time"

	"ansa/core/internal/conversations"
	"ansa/core/internal/tenant"
)

// The interview (the old services/onboarding-interview.ts and
// onboarding-turn.ts): one question at a time, the AI proposing facts from
// the owner's answers. Without the AI it still goes on, with the fixed
// question of the first key topic still missing. Never logs an answer, a
// question or an error's message.

const (
	// How many of the newest messages the page shows.
	messagesShown = 100
	// How many of the newest messages the AI reads each turn.
	messagesForAI = 12
)

// Interview is the Interview page (the old Interview type).
type Interview struct {
	// The newest 100, oldest first.
	Messages            []Message `json:"messages"`
	OlderMessagesHidden bool      `json:"olderMessagesHidden"`
	// While the interview has no message: its first question (fixed text,
	// saved with the first answer) and the topic it asks about.
	Opening *Opening `json:"opening"`
	// ansa's newest message closed the interview, and no key topic is missing now.
	Finished bool `json:"finished"`
}

// Message is one message, decrypted (Text nil: it can't be decrypted).
type Message struct {
	ID         string    `json:"id"`
	Author     string    `json:"author"`
	AuthorName *string   `json:"authorName"`
	Text       *string   `json:"text"`
	Unreadable bool      `json:"unreadable"`
	CreatedAt  time.Time `json:"createdAt"`
}

// Opening is the first question: Topic nil when no key topic was missing.
type Opening struct {
	Topic *string `json:"topic"`
	Text  string  `json:"text"`
}

// ReadInterview reads one company's interview for its page, decrypted.
func (s *Service) ReadInterview(ctx context.Context, company tenant.CompanyID) (Interview, error) {
	// One more than shown, to know whether older messages are left out.
	newestFirst, err := NewestMessages(ctx, s.Pool, company, messagesShown+1)
	if err != nil {
		return Interview{}, err
	}
	facts, err := ReadFacts(ctx, s.Pool, company)
	if err != nil {
		return Interview{}, err
	}
	missing, isMissing := facts.FirstMissingKeyTopic()
	interview := Interview{Messages: []Message{}, OlderMessagesHidden: len(newestFirst) > messagesShown}
	shown := newestFirst[:min(len(newestFirst), messagesShown)]
	for index := len(shown) - 1; index >= 0; index-- {
		interview.Messages = append(interview.Messages, s.decrypt(company, shown[index]))
	}
	if len(newestFirst) == 0 {
		interview.Opening = &Opening{Text: OpeningMessage(missing.Key)}
		if isMissing {
			interview.Opening.Topic = &missing.Key
		}
	}
	// WHY "nothing missing" too: a key proposal dismissed after the closing
	// message makes its topic missing again, and the interview goes on.
	for _, row := range newestFirst {
		if row.Author == "assistant" {
			interview.Finished = row.EndsInterview && !isMissing
			break
		}
	}
	return interview, nil
}

func (s *Service) decrypt(company tenant.CompanyID, row MessageRow) Message {
	message := Message{ID: row.ID, Author: row.Author, AuthorName: row.AuthorName, CreatedAt: row.CreatedAt}
	text, err := s.Box.Decrypt(row.BodyEncrypted, MessageContext(company, row.ID))
	if err != nil {
		s.Log.Warn("could not decrypt stored text: check DATA_ENCRYPTION_KEY")
		message.Unreadable = true
		return message
	}
	message.Text = &text
	return message
}

// AnswerResult is what an answer brought: the topics that got a proposal,
// whether the AI read the answer, and the topic of ansa's own question.
type AnswerResult struct {
	Outcome            string       `json:"outcome"`
	ProposedTopics     []TopicLabel `json:"proposedTopics"`
	AIReadAnswer       bool         `json:"aiReadAnswer"`
	FixedQuestionTopic *TopicLabel  `json:"fixedQuestionTopic"`
}

// StartedOverWhileReading: the interview was started over while the AI
// read the answer, so nothing was saved from it.
const StartedOverWhileReading = "started-over-while-reading"

// Answer saves an owner's answer, asks the brain for the facts it holds
// and the next question, and saves both. The answer is saved first, so it
// is kept even when the AI fails. openingTopic is sent only while the page
// shows the first question (not saved yet): the topic it asked about, ""
// for none; nil otherwise.
func (s *Service) Answer(ctx context.Context, company tenant.CompanyID, ownerUserID, answer string, openingTopic *string) (AnswerResult, error) {
	answerID, err := conversations.NewID()
	if err != nil {
		return AnswerResult{}, err
	}
	answerEncrypted, err := s.Box.Encrypt(answer, MessageContext(company, answerID))
	if err != nil {
		return AnswerResult{}, err
	}
	var opening *NewMessage
	if openingTopic != nil {
		if opening, err = s.newMessage(company, OpeningMessage(*openingTopic)); err != nil {
			return AnswerResult{}, err
		}
	}
	outcome, err := SaveAnswer(ctx, s.Pool, company, ownerUserID, opening, NewMessage{ID: answerID, BodyEncrypted: answerEncrypted})
	if err != nil || outcome != Saved {
		return AnswerResult{Outcome: outcome}, err
	}
	facts, err := ReadFacts(ctx, s.Pool, company)
	if err != nil {
		return AnswerResult{}, err
	}
	reply := BuildReply(s.askTurn(ctx, company, facts), facts)
	message, err := s.newMessage(company, reply.Text)
	if err != nil {
		return AnswerResult{}, err
	}
	topics, outcome, err := SaveReply(ctx, s.Pool, company, ownerUserID, answerID, *message, reply.EndsInterview, reply.Proposals)
	if err != nil || outcome != Saved {
		if outcome == StartedOver {
			outcome = StartedOverWhileReading
		}
		return AnswerResult{Outcome: outcome}, err
	}
	result := AnswerResult{Outcome: Saved, ProposedTopics: labelsOfKeys(topics), AIReadAnswer: reply.AIReadAnswer}
	if topic, ok := FindTopic(reply.FixedQuestionTopic); ok {
		result.FixedQuestionTopic = &TopicLabel{Topic: topic.Key, Label: topic.Label}
	}
	return result, nil
}

// newMessage is one of ansa's messages, with its own new id, encrypted.
func (s *Service) newMessage(company tenant.CompanyID, text string) (*NewMessage, error) {
	id, err := conversations.NewID()
	if err != nil {
		return nil, err
	}
	encrypted, err := s.Box.Encrypt(text, MessageContext(company, id))
	return &NewMessage{ID: id, BodyEncrypted: encrypted}, err
}

// StartOver deletes one company's interview, never its facts (owners).
func (s *Service) StartOver(ctx context.Context, company tenant.CompanyID, actorUserID string) (string, error) {
	return DeleteMessages(ctx, s.Pool, company, actorUserID)
}

func labelsOfKeys(keys []string) []TopicLabel {
	labels := []TopicLabel{}
	for _, key := range keys {
		labels = append(labels, TopicLabel{Topic: key, Label: LabelOf(key)})
	}
	return labels
}
