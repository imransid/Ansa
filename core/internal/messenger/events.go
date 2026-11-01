// Package messenger is the Facebook Messenger channel (the old
// services/messenger-*.ts and adapters/messenger.ts): a business connects
// its Facebook Page (the same connection as posts), and its customers'
// messages reach ansa through Meta's signed webhook. A customer is a
// Page-scoped id (PSID): their contact's id is "<page id>:<psid>", so a
// reply goes back through that Page. This package is the ONLY code that
// talks to Messenger.
package messenger

import (
	"bytes"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
)

// Event is one message event, with only what ansa reads.
type Event struct {
	PageID, SenderID, RecipientID string
	MID, Text, AttachmentKind     string
	IsEcho                        bool
	// The app that sent an echo ("" when Meta names none).
	AppID string
}

// ErrNotForAnsa: the body isn't a Page event ansa reads (answered 200 all
// the same: Meta sends a refused one again and again).
var ErrNotForAnsa = errors.New("messenger: not a Page event ansa reads")

var metaID = regexp.MustCompile(`^\d{1,40}$`)

type rawWebhook struct {
	Object string `json:"object"`
	Entry  []struct {
		ID        string `json:"id"`
		Messaging []struct {
			Sender    struct{ ID string } `json:"sender"`
			Recipient struct{ ID string } `json:"recipient"`
			Message   *struct {
				MID         string          `json:"mid"`
				Text        string          `json:"text"`
				IsEcho      bool            `json:"is_echo"`
				AppID       json.RawMessage `json:"app_id"`
				Attachments []struct {
					Type string `json:"type"`
				} `json:"attachments"`
			} `json:"message"`
		} `json:"messaging"`
	} `json:"entry"`
}

// ParseEvents reads Meta's webhook body: the message events of each entry
// (other events, like reads and deliveries, are left out).
func ParseEvents(body []byte) ([]Event, error) {
	var raw rawWebhook
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&raw); err != nil || raw.Object != "page" || len(raw.Entry) > 100 {
		return nil, ErrNotForAnsa
	}
	var events []Event
	for _, entry := range raw.Entry {
		if !metaID.MatchString(entry.ID) || len(entry.Messaging) > 100 {
			return nil, ErrNotForAnsa
		}
		for _, item := range entry.Messaging {
			if !metaID.MatchString(item.Sender.ID) || !metaID.MatchString(item.Recipient.ID) {
				return nil, ErrNotForAnsa
			}
			m := item.Message
			if m == nil {
				continue
			}
			if m.MID == "" || len(m.MID) > 500 || len(m.Text) > 20_000 || len(m.Attachments) > 20 {
				return nil, ErrNotForAnsa
			}
			event := Event{PageID: entry.ID, SenderID: item.Sender.ID, RecipientID: item.Recipient.ID, MID: m.MID, Text: m.Text, IsEcho: m.IsEcho, AppID: appID(m.AppID)}
			if len(m.Attachments) > 0 && len(m.Attachments[0].Type) <= 50 {
				event.AttachmentKind = m.Attachments[0].Type
			}
			events = append(events, event)
		}
	}
	return events, nil
}

// appID reads Meta's app_id, a number or a string.
func appID(raw json.RawMessage) string {
	text := strings.Trim(string(raw), `"`)
	if metaID.MatchString(text) {
		return text
	}
	return ""
}

// Describe is what ansa keeps of a message: its text, or a line naming its
// attachment (never downloaded: open Messenger to see it). "" = nothing.
func (e Event) Describe() string {
	if strings.TrimSpace(e.Text) != "" {
		return e.Text
	}
	if e.AttachmentKind == "" {
		return ""
	}
	named := map[string]string{"image": "A photo", "video": "A video", "audio": "A voice message", "file": "A file", "sticker": "A sticker"}
	label, known := named[e.AttachmentKind]
	if !known {
		label = "Something"
	}
	return "[" + label + ": open Messenger to see it]"
}

// ContactID is a customer's id on one Page: "<page id>:<psid>".
func ContactID(pageID, psid string) string {
	return pageID + ":" + psid
}

// SplitContactID splits at the LAST ":" (a development stand-in Page's id,
// "dev:stand-in", holds one; a PSID never does).
func SplitContactID(externalID string) (pageID, psid string, ok bool) {
	at := strings.LastIndex(externalID, ":")
	if at <= 0 || at == len(externalID)-1 {
		return "", "", false
	}
	return externalID[:at], externalID[at+1:], true
}
