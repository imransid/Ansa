// Package telegram is core's Telegram Business channel: ansa's one bot,
// added by each business to its own Telegram account as a chatbot. This file
// reads Telegram's updates strictly (only the fields ansa uses, every id a
// safe integer, every text capped); webhook.go checks and handles them.
package telegram

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"
)

// TextMaxLength is the longest text ansa keeps of one Telegram message.
const TextMaxLength = 4096

// Update is one update, with only what ansa reads.
type Update struct {
	Message            *Message
	BusinessConnection *BusinessConnection
	BusinessMessage    *Message
	DeletedMessages    *DeletedMessages
}

// Message is a chat message: to ansa's bot, or in a business's chats.
type Message struct {
	MessageID            string
	Chat                 Chat
	From                 *User
	Text                 string
	Caption              string
	BusinessConnectionID string
	// Sent by ansa's own bot (its reply coming back): not saved again.
	SentByBot bool
	// What else it held ("photo"), or "".
	MediaKind string
}

// Chat is who the message is with.
type Chat struct {
	ID        string
	Type      string
	FirstName string
	LastName  string
	Username  string
}

// User is a Telegram user.
type User struct {
	ID        string
	FirstName string
	LastName  string
	Username  string
}

// BusinessConnection says ansa's bot was added to (or changed on) an account.
type BusinessConnection struct {
	ID         string
	User       User
	UserChatID string
	CanReply   bool
	IsEnabled  bool
}

// DeletedMessages lists messages deleted in a business's chat.
type DeletedMessages struct {
	BusinessConnectionID string
	ChatID               string
	MessageIDs           []string
}

// ErrNotAnUpdate means the body isn't an update ansa can read (answered 200 all
// the same: Telegram would otherwise send it again and again).
var ErrNotAnUpdate = errors.New("telegram: not an update ansa reads")

// The kinds of content ansa names instead of keeping (lib/telegram.ts).
var mediaLabels = map[string]string{
	"photo": "A photo", "video": "A video", "video_note": "A video message", "animation": "A GIF",
	"voice": "A voice message", "audio": "An audio file", "document": "A file", "sticker": "A sticker",
	"location": "A location", "venue": "A place", "contact": "A contact", "poll": "A poll",
}

// The order the old backend checks media kinds in, so both name a message alike.
var mediaOrder = []string{"photo", "video", "video_note", "animation", "voice", "audio", "document", "sticker", "location", "venue", "contact", "poll"}

// ParseUpdate reads one update from the raw body.
func ParseUpdate(body []byte) (*Update, error) {
	var raw struct {
		UpdateID           *json.Number               `json:"update_id"`
		Message            map[string]json.RawMessage `json:"message"`
		BusinessConnection *rawConnection             `json:"business_connection"`
		BusinessMessage    map[string]json.RawMessage `json:"business_message"`
		DeletedMessages    *rawDeleted                `json:"deleted_business_messages"`
	}
	decoder := json.NewDecoder(strings.NewReader(string(body)))
	decoder.UseNumber()
	if err := decoder.Decode(&raw); err != nil || raw.UpdateID == nil {
		return nil, ErrNotAnUpdate
	}
	update := &Update{}
	var err error
	if raw.Message != nil {
		if update.Message, err = parseMessage(raw.Message); err != nil {
			return nil, err
		}
	}
	if raw.BusinessMessage != nil {
		if update.BusinessMessage, err = parseMessage(raw.BusinessMessage); err != nil {
			return nil, err
		}
	}
	if raw.BusinessConnection != nil {
		if update.BusinessConnection, err = raw.BusinessConnection.parse(); err != nil {
			return nil, err
		}
	}
	if raw.DeletedMessages != nil {
		if update.DeletedMessages, err = raw.DeletedMessages.parse(); err != nil {
			return nil, err
		}
	}
	return update, nil
}

// Describe is the text ansa keeps of a message: a line naming what else it
// held, then its text or caption; "" when there is nothing to show.
func (m *Message) Describe() string {
	words := strings.TrimSpace(m.Text)
	if words == "" {
		words = strings.TrimSpace(m.Caption)
	}
	parts := []string{}
	if label, ok := mediaLabels[m.MediaKind]; ok {
		parts = append(parts, "["+label+": open Telegram to see it]")
	}
	if words != "" {
		parts = append(parts, words)
	}
	return cutRunes(strings.Join(parts, "\n"), TextMaxLength)
}

// DisplayName is "Lena Moretti", else "@lena", else "".
func DisplayName(first, last, username string) string {
	name := strings.TrimSpace(strings.TrimSpace(first + " " + last))
	if name != "" {
		return name
	}
	if username != "" {
		return "@" + username
	}
	return ""
}

func parseMessage(raw map[string]json.RawMessage) (*Message, error) {
	var fields struct {
		MessageID            *json.Number `json:"message_id"`
		Chat                 *rawChat     `json:"chat"`
		From                 *rawUser     `json:"from"`
		Text                 string       `json:"text"`
		Caption              string       `json:"caption"`
		BusinessConnectionID string       `json:"business_connection_id"`
	}
	encoded, _ := json.Marshal(raw)
	decoder := json.NewDecoder(strings.NewReader(string(encoded)))
	decoder.UseNumber()
	if err := decoder.Decode(&fields); err != nil || fields.MessageID == nil || fields.Chat == nil {
		return nil, ErrNotAnUpdate
	}
	messageID, okID := safeID(*fields.MessageID)
	chat, errChat := fields.Chat.parse()
	if !okID || errChat != nil || len(fields.Text) > 10_000 || len(fields.Caption) > 10_000 || len(fields.BusinessConnectionID) > 200 {
		return nil, ErrNotAnUpdate
	}
	message := &Message{MessageID: messageID, Chat: chat, Text: fields.Text, Caption: fields.Caption, BusinessConnectionID: fields.BusinessConnectionID}
	if fields.From != nil {
		user, err := fields.From.parse()
		if err != nil {
			return nil, err
		}
		message.From = &user
	}
	_, message.SentByBot = raw["sender_business_bot"]
	for _, kind := range mediaOrder {
		if _, present := raw[kind]; present {
			message.MediaKind = kind
			break
		}
	}
	return message, nil
}

type rawUser struct {
	ID        *json.Number `json:"id"`
	FirstName string       `json:"first_name"`
	LastName  string       `json:"last_name"`
	Username  string       `json:"username"`
}

func (u *rawUser) parse() (User, error) {
	if u.ID == nil {
		return User{}, ErrNotAnUpdate
	}
	id, ok := safeID(*u.ID)
	if !ok || len(u.FirstName) > 1000 || len(u.LastName) > 1000 || len(u.Username) > 100 {
		return User{}, ErrNotAnUpdate
	}
	return User{ID: id, FirstName: u.FirstName, LastName: u.LastName, Username: u.Username}, nil
}

type rawChat struct {
	rawUser
	Type string `json:"type"`
}

func (c *rawChat) parse() (Chat, error) {
	user, err := c.rawUser.parse()
	if err != nil || len(c.Type) > 40 {
		return Chat{}, ErrNotAnUpdate
	}
	return Chat{ID: user.ID, Type: c.Type, FirstName: user.FirstName, LastName: user.LastName, Username: user.Username}, nil
}

type rawConnection struct {
	ID         string       `json:"id"`
	User       *rawUser     `json:"user"`
	UserChatID *json.Number `json:"user_chat_id"`
	Rights     *struct {
		CanReply bool `json:"can_reply"`
	} `json:"rights"`
	IsEnabled *bool `json:"is_enabled"`
}

func (c *rawConnection) parse() (*BusinessConnection, error) {
	if c.ID == "" || len(c.ID) > 200 || c.User == nil || c.UserChatID == nil || c.IsEnabled == nil {
		return nil, ErrNotAnUpdate
	}
	user, err := c.User.parse()
	chatID, ok := safeID(*c.UserChatID)
	if err != nil || !ok {
		return nil, ErrNotAnUpdate
	}
	return &BusinessConnection{ID: c.ID, User: user, UserChatID: chatID, CanReply: c.Rights != nil && c.Rights.CanReply, IsEnabled: *c.IsEnabled}, nil
}

type rawDeleted struct {
	BusinessConnectionID string        `json:"business_connection_id"`
	Chat                 *rawChat      `json:"chat"`
	MessageIDs           []json.Number `json:"message_ids"`
}

func (d *rawDeleted) parse() (*DeletedMessages, error) {
	if d.BusinessConnectionID == "" || len(d.BusinessConnectionID) > 200 || d.Chat == nil || len(d.MessageIDs) > 1000 {
		return nil, ErrNotAnUpdate
	}
	chat, err := d.Chat.parse()
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(d.MessageIDs))
	for _, raw := range d.MessageIDs {
		id, ok := safeID(raw)
		if !ok {
			return nil, ErrNotAnUpdate
		}
		ids = append(ids, id)
	}
	return &DeletedMessages{BusinessConnectionID: d.BusinessConnectionID, ChatID: chat.ID, MessageIDs: ids}, nil
}

// safeID accepts a whole number that fits a JavaScript-safe integer (as the
// old backend does), written back as text.
func safeID(number json.Number) (string, bool) {
	value, err := strconv.ParseInt(number.String(), 10, 64)
	if err != nil || value > 1<<53-1 || value < -(1<<53-1) {
		return "", false
	}
	return strconv.FormatInt(value, 10), true
}

func cutRunes(text string, max int) string {
	if utf8.RuneCountInString(text) <= max {
		return text
	}
	return string([]rune(text)[:max])
}
