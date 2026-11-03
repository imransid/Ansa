// Package phone answers calls live (step 55): someone who couldn't reach the
// person or the business talks with ansa, turn by turn. It is the ONE door
// every phone line uses: Start, Turn and End take what a line knows (the
// caller's number and name, their words as text) and give back what to say.
// The first line is the development practice phone (a page on the laptop:
// the caller's voice is heard by the brain's local Whisper, ansa's words are
// spoken by the browser). A production provider (Vapi, Twilio, Telnyx or
// LiveKit, chosen at launch) will be another line: one file that turns its
// events into these three calls, and a name in phone_calls_line_known.
package phone

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"ansa/core/internal/assistant"
	"ansa/core/internal/brainclient"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/packages"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
	"ansa/core/internal/tickets"
)

// The lines a call can come from (phone_calls.line).
const LinePractice = "practice"

// The most a caller's turn may say (a few minutes of speech).
const maxWords = 2_000

var (
	// ErrBadNumber: the caller's number has fewer than 7 digits, or is a
	// hidden caller's placeholder.
	ErrBadNumber = errors.New("phone: the caller's number can't be read")
	// ErrCallOver: no live call of this company has that id.
	ErrCallOver = errors.New("phone: the call is over")
	// ErrNotHeard: the caller's voice couldn't be turned into words.
	ErrNotHeard = errors.New("phone: the caller's words couldn't be heard")
)

// Service answers calls through the assistant (the same brain, checks,
// orders and requests as chats). Brain hears the practice phone's audio.
type Service struct {
	Pool      *database.Pool
	Box       *secure.Box
	Assistant *assistant.Runner
	Brain     *brainclient.Client
	Log       *logging.Logger
}

// Caller is who is calling, as the line knows them.
type Caller struct {
	Line   string
	Number string
	// As the caller or the line gave it ("" when unknown).
	Name string
}

// Started is a new live call and what ansa says when it picks up.
type Started struct {
	CallID         string
	ConversationID string
	Words          []string
}

// Start picks up a call: the caller's phone conversation (made on their first
// call), a live call in it (ending one left live before), and ansa's
// greeting, which says who it is and whether it can help or only take a
// message (the assistant paused, a person handling the conversation, or a
// caller marked important).
func (s *Service) Start(ctx context.Context, company tenant.CompanyID, caller Caller) (Started, error) {
	digits := tickets.CustomerPhoneDigits(caller.Number)
	if digits == "" {
		return Started{}, ErrBadNumber
	}
	contact := conversations.ContactKey{Channel: conversations.ChannelPhone, ExternalID: digits}
	if name := plaintext.SingleLine(caller.Name); name != "" && utf8.RuneCountInString(name) <= 200 {
		contact.DisplayName = &name
	}
	conversationID, err := conversations.ConversationFor(ctx, s.Pool, company, contact)
	if err != nil {
		return Started{}, err
	}
	callID, err := startCall(ctx, s.Pool, company, conversationID, caller.Line)
	if err != nil {
		return Started{}, err
	}
	messageOnly, err := assistant.CallTakesMessagesOnly(ctx, s.Pool, company, conversationID)
	if err != nil {
		return Started{}, err
	}
	// No call minutes left in the package this month (step 57): ansa only
	// takes a message, without the AI.
	timeLeft, err := packages.CallTimeLeft(ctx, s.Pool, company, time.Now(), 0)
	if err != nil {
		return Started{}, err
	}
	kind, name, err := assistant.ReadCallVoice(ctx, s.Pool, company)
	if err != nil {
		return Started{}, err
	}
	greeting := Greeting(kind, name, !messageOnly && timeLeft)
	if err := assistant.SayOnCall(ctx, s.Pool, s.Box, company, conversationID, greeting); err != nil {
		return Started{}, err
	}
	return Started{CallID: callID, ConversationID: conversationID, Words: []string{greeting}}, nil
}

// Turn is one thing the caller said (as words) and ansa's answer: saved in
// the conversation, answered at once while the caller waits. Words nobody
// could make out get ansa's "say it again" and are not saved.
func (s *Service) Turn(ctx context.Context, company tenant.CompanyID, callID, words string) ([]string, error) {
	conversationID, err := liveCall(ctx, s.Pool, company, callID)
	if err != nil {
		return nil, err
	}
	// One plain line: what a voice said has no layout to keep.
	words = strings.TrimSpace(plaintext.SingleLine(words))
	if words == "" {
		return []string{DidntCatchText}, nil
	}
	if utf8.RuneCountInString(words) > maxWords {
		words = string([]rune(words)[:maxWords])
	}
	messageID, err := conversations.NewID()
	if err != nil {
		return nil, err
	}
	body, err := s.Box.Encrypt(words, conversations.MessageContext(company, messageID))
	if err != nil {
		return nil, err
	}
	message := conversations.IncomingMessage{ID: messageID, BodyEncrypted: body, ChannelMessageID: "call:" + callID + ":" + messageID}
	turn, err := conversations.InsertCallerWords(ctx, s.Pool, company, conversationID, message)
	if err != nil {
		return nil, err
	}
	if turn == nil {
		return nil, ErrCallOver
	}
	answer, err := s.Assistant.AnswerCall(ctx, *turn)
	if err != nil {
		return nil, err
	}
	if answer.TookMessage {
		if err := countMessageTaken(ctx, s.Pool, company, callID); err != nil {
			return nil, err
		}
	}
	return answer.Words, nil
}

// End hangs up: the call is over, a request is opened for what the caller
// said while ansa only took messages (unless one is open already), and the
// AI writes the call's note for the person (a job: the caller isn't kept
// waiting). Ending a call that is already over changes nothing.
func (s *Service) End(ctx context.Context, company tenant.CompanyID, callID string) error {
	return endCall(ctx, s.Pool, company, callID)
}

// The languages the practice phone's recordings may be heard in: "auto"
// lets Whisper tell, "bn" Bangla, "en" English (the brain's TranscribeRequest).
var HearingLanguages = map[string]bool{"auto": true, "bn": true, "en": true}

// Hear turns the practice phone's recording (16 kHz mono WAV) into the
// caller's words, with the brain's local Whisper (development only), in
// the language the caller picked (HearingLanguages).
func (s *Service) Hear(ctx context.Context, audioWAV []byte, language string) (string, error) {
	var answer struct {
		Text string `json:"text"`
	}
	if !HearingLanguages[language] {
		language = "auto"
	}
	request := map[string]any{"audio_wav": audioWAV, "language": language}
	if err := s.Brain.Call(ctx, "/v1/voice/transcribe", request, &answer); err != nil {
		s.Log.Warn("phone: the brain couldn't hear the recording", logging.ErrorType(err))
		return "", ErrNotHeard
	}
	return answer.Text, nil
}
