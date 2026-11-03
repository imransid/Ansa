// Package practicechat is the development practice chat (step 58, for
// demos): an owner writes as a made-up customer on Telegram, WhatsApp or
// Messenger through the company's stand-in account (Settings →
// Connections), and reads the chat as that customer sees it. A message is
// saved as each channel's own code saves a customer's (in the customer's
// conversation, encrypted, the assistant's reply queued), so replies,
// orders, requests and alerts work exactly as for a real customer. An
// owner may also send an email as one (email.go): it arrives at the
// company's forwarding address as a forwarded email does, and becomes a
// request. Development only: the API refuses it in production.
package practicechat

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/assistant"
	"ansa/core/internal/commands"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/inbox"
	"ansa/core/internal/messenger"
	"ansa/core/internal/secure"
	"ansa/core/internal/standins"
	"ansa/core/internal/tenant"
	"ansa/core/internal/whatsapp"
)

// Channels the practice chat writes on.
var Channels = []string{"whatsapp", "telegram", "messenger"}

// ErrNoStandIn: the company has no stand-in account on that channel (yet).
var ErrNoStandIn = errors.New("practicechat: no stand-in account on this channel")

// StandIns says which channels have a stand-in account connected.
func StandIns(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (map[string]bool, error) {
	connected := map[string]bool{}
	for _, channel := range Channels {
		account, err := standInAccount(ctx, pool, company, channel)
		if err != nil {
			return nil, err
		}
		connected[channel] = account != ""
	}
	return connected, nil
}

// Send saves the made-up customer's message on the channel and returns it
// (its conversation and the message); core's workers answer it in a moment.
func Send(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, channel, name, text string) (*conversations.Turn, error) {
	account, err := standInAccount(ctx, pool, company, channel)
	if err != nil {
		return nil, err
	}
	if account == "" {
		return nil, ErrNoStandIn
	}
	contact := conversations.ContactKey{Channel: channel, ExternalID: customerOf(channel, account, name), DisplayName: &name}
	id, err := conversations.NewID()
	if err != nil {
		return nil, err
	}
	body, err := box.Encrypt(text, conversations.MessageContext(company, id))
	if err != nil {
		return nil, err
	}
	return conversations.InsertCustomerMessage(ctx, pool, company, contact, conversations.IncomingMessage{ID: id, BodyEncrypted: body, ChannelMessageID: "practice-" + id})
}

// Find is the made-up customer's conversation on the channel ("" before
// their first message, or without a stand-in account), so the chat page
// shows it again after a reload.
func Find(ctx context.Context, pool *database.Pool, company tenant.CompanyID, channel, name string) (string, error) {
	account, err := standInAccount(ctx, pool, company, channel)
	if err != nil || account == "" {
		return "", err
	}
	const statement = `
		SELECT conversations.id FROM conversations
		JOIN contacts ON contacts.id = conversations.contact_id AND contacts.company_id = conversations.company_id
		WHERE conversations.company_id = $1 AND contacts.channel = $2 AND contacts.external_id = $3`
	var id string
	err = pool.QueryRow(ctx, statement, company.String(), channel, customerOf(channel, account, name)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// standInAccount is the company's stand-in account on the channel: the
// Telegram business connection, the WhatsApp number or the Facebook Page
// ("" for none).
func standInAccount(ctx context.Context, pool *database.Pool, company tenant.CompanyID, channel string) (string, error) {
	switch channel {
	case "telegram":
		return commands.StandInTelegramConnection(ctx, pool, company)
	case "whatsapp":
		return commands.StandInWhatsAppNumber(ctx, pool, company)
	case "messenger":
		return commands.StandInFacebookPage(ctx, pool, company)
	}
	return "", nil
}

// customerOf is the made-up customer's id as the channel's own code keeps
// it (the same name is the same customer, as with the simulate tools).
func customerOf(channel, account, name string) string {
	switch channel {
	case "telegram":
		return strconv.FormatUint(standins.TelegramChatID(name), 10)
	case "whatsapp":
		return whatsapp.ContactID(account, standins.WhatsAppCustomer(name))
	}
	return messenger.ContactID(account, standins.PSID(name))
}

// Line is one message of the chat as the customer sees it.
type Line struct {
	FromCustomer bool      `json:"fromCustomer"`
	Text         string    `json:"text"`
	At           time.Time `json:"at"`
}

// Chat is the chat as the customer sees it, and what ansa does next with
// their newest message (for the presenter: "ansa is writing..." only when
// ansa will write).
type Chat struct {
	Lines []Line         `json:"lines"`
	Next  assistant.Next `json:"next"`
}

// Read is the conversation as the customer sees it: their own messages and
// what reached them (ansa's and the business's replies), never a reply
// waiting for the owner's approval or one discarded; and what ansa does
// next, read with the assistant's own gate and away settings.
// inbox.ErrNotFound: not this company's conversation.
func Read(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, conversationID string) (*Chat, error) {
	page, err := inbox.ReadPage(ctx, pool, box, company, conversationID)
	if err != nil {
		return nil, err
	}
	chat := &Chat{Lines: []Line{}}
	for _, entry := range page.Entries {
		if entry.Text == nil || (entry.SendStatus != nil && !reachedCustomer[*entry.SendStatus]) {
			continue
		}
		chat.Lines = append(chat.Lines, Line{FromCustomer: entry.Author == "customer", Text: *entry.Text, At: entry.CreatedAt})
	}
	chat.Next, err = assistant.WhatNext(ctx, pool, company, page.ID, time.Now())
	return chat, err
}

// The send statuses of a reply the customer has (or may have) got.
var reachedCustomer = map[string]bool{"sending": true, "sent": true, "unclear": true}
