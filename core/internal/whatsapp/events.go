package whatsapp

import (
	"bytes"
	"encoding/json"
	"errors"
)

// What one webhook event is.
const (
	// A customer wrote to the business.
	KindMessage = "message"
	// The business wrote to a customer from the WhatsApp Business app.
	KindEcho = "echo"
	// Meta ended, or restored, the link to a business account.
	KindAccount = "account"
)

// The account changes ansa follows, and the status each one leads to.
var accountEvents = map[string]string{
	"PARTNER_REMOVED":     "removed_in_whatsapp",
	"ACCOUNT_OFFBOARDED":  "removed_in_whatsapp",
	"ACCOUNT_RECONNECTED": "connected",
}

// Event is one event of a webhook, with only what ansa reads.
type Event struct {
	Kind string
	// Messages and echoes: the business number (Meta's id), the customer,
	// the message's id, its text and what kind of message it is.
	PhoneNumberID, CustomerID, CustomerName string
	MessageID, Text, MessageType            string
	// Account changes: the business account and the status it leads to.
	WABAID, NewStatus string
}

// ErrNotForAnsa: the body isn't a WhatsApp event ansa reads (answered 200
// all the same: Meta sends a refused one again and again).
var ErrNotForAnsa = errors.New("whatsapp: not an event ansa reads")

type rawWebhook struct {
	Object string `json:"object"`
	Entry  []struct {
		ID      string `json:"id"`
		Changes []struct {
			Field string          `json:"field"`
			Value json.RawMessage `json:"value"`
		} `json:"changes"`
	} `json:"entry"`
}

type rawContact struct {
	Profile struct {
		Name string `json:"name"`
	} `json:"profile"`
	WaID   string `json:"wa_id"`
	UserID string `json:"user_id"`
}

type rawMessage struct {
	From       string `json:"from"`
	FromUserID string `json:"from_user_id"`
	To         string `json:"to"`
	ToUserID   string `json:"to_user_id"`
	ID         string `json:"id"`
	Type       string `json:"type"`
	Text       *struct {
		Body string `json:"body"`
	} `json:"text"`
	Button *struct {
		Text string `json:"text"`
	} `json:"button"`
	Interactive *struct {
		ButtonReply *struct {
			Title string `json:"title"`
		} `json:"button_reply"`
		ListReply *struct {
			Title string `json:"title"`
		} `json:"list_reply"`
	} `json:"interactive"`
	// A photo, a video or a file may come with words of the customer's own.
	Image    *media `json:"image"`
	Video    *media `json:"video"`
	Document *media `json:"document"`
}

type media struct {
	Caption string `json:"caption"`
}

type rawValue struct {
	Metadata struct {
		PhoneNumberID string `json:"phone_number_id"`
	} `json:"metadata"`
	Contacts      []rawContact `json:"contacts"`
	Messages      []rawMessage `json:"messages"`
	MessageEchoes []rawMessage `json:"message_echoes"`
	Event         string       `json:"event"`
	WABAInfo      *struct {
		WABAID string `json:"waba_id"`
	} `json:"waba_info"`
}

// ParseEvents reads Meta's webhook body: customers' messages, the
// business's echoes and account changes (statuses, history and the rest
// are left out). Anything odd in what ansa reads refuses the whole body.
func ParseEvents(body []byte) ([]Event, error) {
	var raw rawWebhook
	if err := json.NewDecoder(bytes.NewReader(body)).Decode(&raw); err != nil || raw.Object != "whatsapp_business_account" || len(raw.Entry) > 100 {
		return nil, ErrNotForAnsa
	}
	var events []Event
	for _, entry := range raw.Entry {
		if len(entry.Changes) > 100 {
			return nil, ErrNotForAnsa
		}
		for _, change := range entry.Changes {
			found, err := parseChange(entry.ID, change.Field, change.Value)
			if err != nil {
				return nil, err
			}
			events = append(events, found...)
		}
	}
	return events, nil
}

func parseChange(entryID, field string, rawValueBytes json.RawMessage) ([]Event, error) {
	if field != "messages" && field != "smb_message_echoes" && field != "account_update" {
		return nil, nil
	}
	var value rawValue
	if err := json.Unmarshal(rawValueBytes, &value); err != nil || len(value.Messages) > 100 || len(value.MessageEchoes) > 100 || len(value.Contacts) > 100 {
		return nil, ErrNotForAnsa
	}
	switch field {
	case "account_update":
		return accountEvent(entryID, value)
	case "smb_message_echoes":
		return messageEvents(KindEcho, value, value.MessageEchoes)
	}
	return messageEvents(KindMessage, value, value.Messages)
}

// accountEvent: the business account is named in waba_info, or by the
// entry itself (Meta's examples differ); other changes are left out.
func accountEvent(entryID string, value rawValue) ([]Event, error) {
	status, followed := accountEvents[value.Event]
	if !followed {
		return nil, nil
	}
	waba := entryID
	if value.WABAInfo != nil && value.WABAInfo.WABAID != "" {
		waba = value.WABAInfo.WABAID
	}
	if !metaID.MatchString(waba) {
		return nil, ErrNotForAnsa
	}
	return []Event{{Kind: KindAccount, WABAID: waba, NewStatus: status}}, nil
}

func messageEvents(kind string, value rawValue, messages []rawMessage) ([]Event, error) {
	if len(messages) > 0 && !metaID.MatchString(value.Metadata.PhoneNumberID) {
		return nil, ErrNotForAnsa
	}
	var events []Event
	for _, m := range messages {
		customer := customerOf(kind, m)
		if !customerID.MatchString(customer) || m.ID == "" || len(m.ID) > 500 || len(m.Type) > 50 {
			return nil, ErrNotForAnsa
		}
		text := m.text()
		if len(text) > 20_000 {
			return nil, ErrNotForAnsa
		}
		event := Event{Kind: kind, PhoneNumberID: value.Metadata.PhoneNumberID, CustomerID: customer, MessageID: m.ID, Text: text, MessageType: m.Type}
		if kind == KindMessage {
			event.CustomerName = nameOf(value.Contacts, m)
		}
		events = append(events, event)
	}
	return events, nil
}
