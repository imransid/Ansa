// Package conversations keeps the Inbox: one contact per customer and
// channel, one conversation per contact, and its messages (text encrypted
// with the context "conversation-message:<company>:<message>", as the old
// backend). Every function takes the company first; every write names it.
package conversations

import "ansa/core/internal/tenant"

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
