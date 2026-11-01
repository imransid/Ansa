// Package conversations keeps the Inbox: one contact per customer and
// channel, one conversation per contact, and its messages (text encrypted
// with the context "conversation-message:<company>:<message>", as the old
// backend). Every function takes the company first; every write names it.
package conversations

import (
	"crypto/rand"
	"fmt"

	"ansa/core/internal/tenant"
)

// Channels a contact can come from (the same values as the old backend's).
const (
	ChannelTelegram  = "telegram"
	ChannelMessenger = "messenger"
	ChannelPhone     = "phone"
	ChannelEmail     = "email"
	ChannelStandIn   = "stand_in"
)

// ContactKey says who a customer is on one channel.
type ContactKey struct {
	Channel    string
	ExternalID string
	// The name the channel gave, or nil.
	DisplayName *string
}

// IncomingMessage is a customer's chat message, already encrypted for its id.
type IncomingMessage struct {
	ID               string
	BodyEncrypted    string
	ChannelMessageID string
}

// Turn is a saved customer message the assistant may answer.
type Turn struct {
	CompanyID        tenant.CompanyID
	ConversationID   string
	TriggerMessageID string
}

// MessageContext is the encryption context of one conversation message.
func MessageContext(company tenant.CompanyID, messageID string) string {
	return "conversation-message:" + company.String() + ":" + messageID
}

// NewID makes a random id (UUID version 4) for a row core writes, known
// before the INSERT because a message's encryption context names it.
func NewID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:]), nil
}
