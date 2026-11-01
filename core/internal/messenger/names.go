package messenger

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/secure"
	"ansa/core/internal/social"
)

// NameJobKind reads a Messenger customer's name from Meta, once: Meta's
// message carries only an id.
const NameJobKind = "messenger.name"

// NamePayload names the conversation, the Page's connection and the customer.
type NamePayload struct {
	ConversationID string `json:"conversationId"`
	ConnectionID   string `json:"connectionId"`
	PSID           string `json:"psid"`
}

// Names runs the name job. Best effort: without a name the Inbox shows
// "Messenger customer".
type Names struct {
	Pool      *database.Pool
	Box       *secure.Box
	AppSecret string
}

// HandleJob reads the name when the contact has none and ansa's Meta app is set up.
func (n *Names) HandleJob(ctx context.Context, job *jobs.Job) error {
	var payload NamePayload
	if json.Unmarshal(job.Payload, &payload) != nil || !metaID.MatchString(payload.PSID) {
		return &jobs.Failure{Code: "bad_payload", Permanent: true}
	}
	if n.AppSecret == "" {
		return nil
	}
	needs, err := contactNeedsName(ctx, n.Pool, job.CompanyID, payload.ConversationID)
	if err != nil || !needs {
		return err
	}
	token, err := social.PageToken(ctx, n.Pool, n.Box, job.CompanyID, payload.ConnectionID)
	if err == social.ErrNotUsable {
		return nil
	}
	if err != nil {
		return err
	}
	name := plaintext.SingleLine(Name(ctx, n.AppSecret, payload.PSID, token))
	if utf8.RuneCountInString(name) > 200 {
		name = strings.TrimSpace(string([]rune(name)[:200]))
	}
	if name == "" {
		return nil
	}
	return fillNameOnce(ctx, n.Pool, job.CompanyID, payload.ConversationID, name)
}
