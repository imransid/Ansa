package whatsapp

import (
	"testing"
)

const userID = "US.13491208655302741918"

func messagesBody(phoneNumberID, messages string) string {
	return `{"object":"whatsapp_business_account","entry":[{"id":"102290129340398","changes":[{"field":"messages","value":{
		"messaging_product":"whatsapp","metadata":{"display_phone_number":"15550783881","phone_number_id":"` + phoneNumberID + `"},
		"contacts":[{"profile":{"name":"Sheena Nelson"},"user_id":"` + userID + `","wa_id":"16315551181"}],
		"messages":[` + messages + `]}}]}]}`
}

// A customer's messages: their business-scoped id (else their number),
// their name, and what ansa keeps of each kind of message.
func TestMessagesAreReadWithTheCustomersOwnID(t *testing.T) {
	body := messagesBody("106540352242922", `
		{"from":"16315551181","from_user_id":"`+userID+`","id":"wamid.1","timestamp":"1749416383","type":"text","text":{"body":"Does it come in another color?"}},
		{"from":"16315551181","id":"wamid.2","type":"image","image":{"caption":"This one"}},
		{"from_user_id":"`+userID+`","id":"wamid.3","type":"audio","audio":{"id":"55"}},
		{"from_user_id":"`+userID+`","id":"wamid.4","type":"reaction","reaction":{"emoji":"👍"}},
		{"from_user_id":"`+userID+`","id":"wamid.5","type":"interactive","interactive":{"button_reply":{"title":"Yes, deliver"}}}`)
	events, err := ParseEvents([]byte(body))
	if err != nil || len(events) != 5 {
		t.Fatalf("events: %+v %v", events, err)
	}
	first := events[0]
	if first.Kind != KindMessage || first.PhoneNumberID != "106540352242922" || first.CustomerID != userID || first.CustomerName != "Sheena Nelson" || first.Describe() != "Does it come in another color?" {
		t.Fatalf("a text, from the business-scoped id, with the name: %+v", first)
	}
	if events[1].CustomerID != "16315551181" || events[1].Describe() != "[A photo: open WhatsApp to see it]\nThis one" {
		t.Fatalf("no user id: the number; a photo named, its caption kept: %+v", events[1])
	}
	if events[2].Describe() != "[A voice message: open WhatsApp to see it]" || events[3].Describe() != "" || events[4].Describe() != "Yes, deliver" {
		t.Fatalf("a voice message named (never downloaded), a reaction kept out, a button's choice kept: %q %q %q", events[2].Describe(), events[3].Describe(), events[4].Describe())
	}
}

// Echoes (the business's own messages from the WhatsApp Business app) and
// account changes; statuses and other fields are left out; anything odd in
// what ansa reads refuses the body.
func TestEchoesAccountChangesAndOddBodies(t *testing.T) {
	body := `{"object":"whatsapp_business_account","entry":[{"id":"862475293675413","changes":[
		{"field":"smb_message_echoes","value":{"messaging_product":"whatsapp","metadata":{"phone_number_id":"106540352242922"},
			"message_echoes":[{"from":"15550783881","to":"16315551181","id":"wamid.e1","type":"text","text":{"body":"On my way"}}]}},
		{"field":"messages","value":{"metadata":{"phone_number_id":"106540352242922"},"statuses":[{"id":"wamid.x","status":"read"}]}},
		{"field":"account_update","value":{"event":"PARTNER_REMOVED","waba_info":{"waba_id":"777","owner_business_id":"1"}}},
		{"field":"account_update","value":{"event":"ACCOUNT_RECONNECTED"}},
		{"field":"account_update","value":{"event":"VERIFIED_ACCOUNT"}},
		{"field":"history","value":{"history":[]}}]}]}`
	events, err := ParseEvents([]byte(body))
	if err != nil || len(events) != 3 {
		t.Fatalf("events: %+v %v", events, err)
	}
	if events[0].Kind != KindEcho || events[0].CustomerID != "16315551181" || events[0].Describe() != "On my way" {
		t.Fatalf("an echo names the customer it went to: %+v", events[0])
	}
	if events[1] != (Event{Kind: KindAccount, WABAID: "777", NewStatus: "removed_in_whatsapp"}) || events[2] != (Event{Kind: KindAccount, WABAID: "862475293675413", NewStatus: "connected"}) {
		t.Fatalf("account changes: %+v %+v", events[1], events[2])
	}
	for _, bad := range []string{
		`not json`,
		`{"object":"page","entry":[]}`,
		messagesBody("abc", `{"from":"16315551181","id":"wamid.1","type":"text","text":{"body":"x"}}`),
		messagesBody("106540352242922", `{"from":"163:15551181","id":"wamid.1","type":"text","text":{"body":"x"}}`),
		messagesBody("106540352242922", `{"from":"16315551181","id":"","type":"text","text":{"body":"x"}}`),
	} {
		if _, err := ParseEvents([]byte(bad)); err != ErrNotForAnsa {
			t.Fatalf("%.80s: %v", bad, err)
		}
	}
	if phone, customer, ok := SplitContactID("stand-in:0b5c:XX.lena"); !ok || phone != "stand-in:0b5c" || customer != "XX.lena" {
		t.Fatal("split at the last colon")
	}
}
