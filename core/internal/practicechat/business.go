package practicechat

import (
	"context"
	"errors"
	"strconv"

	"ansa/core/internal/commands"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/messenger"
	"ansa/core/internal/secure"
	"ansa/core/internal/standins"
	"ansa/core/internal/telegram"
	"ansa/core/internal/tenant"
	"ansa/core/internal/whatsapp"
)

// ErrNoConversation: the made-up customer hasn't written yet, so there is
// nothing for the business to answer.
var ErrNoConversation = errors.New("practicechat: the customer hasn't written yet")

// SendAsBusiness answers the made-up customer as the business itself, from
// its own app, and returns their conversation. It is saved through each
// channel's own code for the business's own message, so ansa steps back
// exactly as for a real one (conversations.InsertBusinessAccountMessage):
// Telegram, a message from the stand-in account's own user, through core's
// Telegram update handling; WhatsApp, an echo of the WhatsApp Business app
// (whatsapp.SaveEvent); Messenger, the Page's own message
// (messenger.SavePagesOwnMessage). The customer writes first.
func SendAsBusiness(ctx context.Context, pool *database.Pool, box *secure.Box, log *logging.Logger, company tenant.CompanyID, channel, name, text string) (string, error) {
	account, err := standInAccount(ctx, pool, company, channel)
	if err != nil {
		return "", err
	}
	if account == "" {
		return "", ErrNoStandIn
	}
	conversationID, err := Find(ctx, pool, company, channel, name)
	if err != nil {
		return "", err
	}
	if conversationID == "" {
		return "", ErrNoConversation
	}
	id, err := conversations.NewID()
	if err != nil {
		return "", err
	}
	messageID := "practice-" + id
	switch channel {
	case "telegram":
		err = answerOnTelegram(ctx, pool, box, log, company, account, name, text, messageID)
	case "whatsapp":
		event := whatsapp.Event{Kind: whatsapp.KindEcho, PhoneNumberID: account, CustomerID: standins.WhatsAppCustomer(name), MessageID: messageID, Text: text, MessageType: "text"}
		err = whatsapp.SaveEvent(ctx, pool, box, company, event)
	default:
		event := messenger.Event{PageID: account, SenderID: account, RecipientID: standins.PSID(name), MID: messageID, Text: text, IsEcho: true}
		err = messenger.SavePagesOwnMessage(ctx, pool, box, company, event)
	}
	return conversationID, err
}

// answerOnTelegram hands core's Telegram update handling a message the
// stand-in account's own user wrote in the customer's chat, as Telegram
// sends one to a business's chatbot.
func answerOnTelegram(ctx context.Context, pool *database.Pool, box *secure.Box, log *logging.Logger, company tenant.CompanyID, connectionID, name, text, messageID string) error {
	accountUser, err := commands.StandInTelegramAccountUser(ctx, pool, company)
	if err != nil {
		return err
	}
	if accountUser == "" {
		// Disconnected meanwhile: a message from no one would be the customer's.
		return ErrNoStandIn
	}
	chat := telegram.Chat{ID: strconv.FormatUint(standins.TelegramChatID(name), 10), Type: "private", FirstName: name}
	message := &telegram.Message{MessageID: messageID, Chat: chat, From: &telegram.User{ID: accountUser}, Text: text, BusinessConnectionID: connectionID}
	hook := &telegram.Webhook{Pool: pool, Box: box, Log: log}
	return hook.HandleUpdate(ctx, &telegram.Update{BusinessMessage: message})
}
