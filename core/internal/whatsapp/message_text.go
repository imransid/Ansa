package whatsapp

import "strings"

// What ansa reads of one message: who the customer is, their name, and
// the words to keep.

// customerOf is the customer's id: their business-scoped user id when Meta
// sends one, else their number (an echo names the customer it went to).
func customerOf(kind string, m rawMessage) string {
	if kind == KindEcho {
		return firstOf(m.ToUserID, m.To)
	}
	return firstOf(m.FromUserID, m.From)
}

// nameOf is the customer's name as WhatsApp gives it, from the contact the
// message came from.
func nameOf(contacts []rawContact, m rawMessage) string {
	for _, contact := range contacts {
		if (contact.UserID != "" && contact.UserID == m.FromUserID) || (contact.WaID != "" && contact.WaID == m.From) {
			if len(contact.Profile.Name) <= 1_000 {
				return contact.Profile.Name
			}
		}
	}
	return ""
}

// text is what the customer wrote: the text, a button's or a list's
// choice, or a photo's, video's or file's caption.
func (m rawMessage) text() string {
	switch {
	case m.Text != nil:
		return m.Text.Body
	case m.Button != nil:
		return m.Button.Text
	case m.Interactive != nil && m.Interactive.ButtonReply != nil:
		return m.Interactive.ButtonReply.Title
	case m.Interactive != nil && m.Interactive.ListReply != nil:
		return m.Interactive.ListReply.Title
	}
	for _, attached := range []*media{m.Image, m.Video, m.Document} {
		if attached != nil {
			return attached.Caption
		}
	}
	return ""
}

func firstOf(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// Describe is what ansa keeps of a message: its text (a caption under a
// line naming what it came with), or a line naming what it is (never
// downloaded: open WhatsApp to see it). "" = nothing to keep.
func (e Event) Describe() string {
	named := map[string]string{"image": "A photo", "video": "A video", "audio": "A voice message", "document": "A file", "sticker": "A sticker",
		"location": "A location", "contacts": "A contact card"}
	label, isMedia := named[e.MessageType]
	text := strings.TrimSpace(e.Text)
	switch {
	case isMedia && text != "":
		return "[" + label + ": open WhatsApp to see it]\n" + e.Text
	case text != "":
		return e.Text
	case isMedia:
		return "[" + label + ": open WhatsApp to see it]"
	case e.MessageType == "reaction" || e.MessageType == "system" || e.MessageType == "request_welcome":
		// An emoji on a message, WhatsApp's own notices, a chat just opened: nothing said.
		return ""
	}
	return "[A message ansa can't show: open WhatsApp to see it]"
}
