package profile

import (
	"context"
	"regexp"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// Service is the interview and the suggestions: the database, the
// encryption of interview messages, the brain, and a log for fixed lines.
type Service struct {
	Pool  *database.Pool
	Box   *secure.Box
	Brain *brainclient.Client
	Log   *logging.Logger
}

// The brain's endpoints this package asks.
const (
	interviewTurnPath   = "/v1/cofounder/interview-turn"
	factSuggestionsPath = "/v1/cofounder/fact-suggestions"
)

// BrainTopic is one topic as the brain gets it: its key, label, whether it
// is a key fact, and its values ("" = none). Never an id or a person.
type BrainTopic struct {
	Key       string `json:"key"`
	Label     string `json:"label"`
	KeyFact   bool   `json:"key_fact"`
	Confirmed string `json:"confirmed"`
	Proposed  string `json:"proposed"`
}

// BrainTopics are every topic of the profile, in the interview's order.
func BrainTopics(facts Facts) []BrainTopic {
	topics := make([]BrainTopic, 0, len(Topics))
	for _, topic := range Topics {
		values := facts[topic.Key]
		topics = append(topics, BrainTopic{Key: topic.Key, Label: topic.Label, KeyFact: topic.IsKey, Confirmed: values.Confirmed, Proposed: values.Proposed})
	}
	return topics
}

// BrainFailure is how the brain says no usable answer came: "failed", why
// (model_unavailable, model_failed, unusable_answer) and the model error's class.
type BrainFailure struct {
	Kind      string `json:"kind"`
	Reason    string `json:"reason"`
	ErrorName string `json:"error_name"`
}

// Unavailable: no AI could be asked (no key), as the pages word it apart.
func (f BrainFailure) Unavailable() bool { return f.Reason == "model_unavailable" }

var errorClassName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,59}$`)

// LogFailure writes one fixed line when the model failed, with its class
// only (a revoked key and a wrong model name need different fixes); never
// the prompt, the answer or an error's message.
func LogFailure(log *logging.Logger, event string, failure BrainFailure, err error) {
	if err != nil {
		log.Warn(event, logging.Code("brain_unavailable"))
		return
	}
	if failure.Reason != "model_failed" {
		return
	}
	class := failure.ErrorName
	if !errorClassName.MatchString(class) {
		class = "unknown"
	}
	log.Warn(event, logging.Code(class))
}

// askTurn asks the brain about one company's newest messages (the answer
// just saved among them) with its profile: nil without a usable answer.
func (s *Service) askTurn(ctx context.Context, company tenant.CompanyID, facts Facts) *Turn {
	newestFirst, err := NewestMessages(ctx, s.Pool, company, messagesForAI)
	if err != nil {
		return nil
	}
	type brainMessage struct {
		Author string `json:"author"`
		Text   string `json:"text"`
	}
	messages := []brainMessage{}
	for index := len(newestFirst) - 1; index >= 0; index-- {
		// One that can't be decrypted is left out: there is nothing to read.
		if text := s.decrypt(company, newestFirst[index]).Text; text != nil {
			messages = append(messages, brainMessage{Author: newestFirst[index].Author, Text: *text})
		}
	}
	request := map[string]any{"topics": BrainTopics(facts), "messages": messages}
	var answer struct {
		BrainFailure
		ProposedFacts     []Proposal `json:"proposed_facts"`
		NextQuestion      string     `json:"next_question"`
		InterviewComplete bool       `json:"interview_complete"`
	}
	err = s.Brain.Call(ctx, interviewTurnPath, request, &answer)
	LogFailure(s.Log, "interview: the AI failed", answer.BrainFailure, err)
	if err != nil || answer.Kind != "ok" {
		return nil
	}
	question := CutToLength(plaintext.SingleLine(answer.NextQuestion), QuestionMaxLength)
	if question == "" {
		return nil
	}
	return &Turn{Proposals: CheckProposals(answer.ProposedFacts), NextQuestion: question, InterviewComplete: answer.InterviewComplete}
}
