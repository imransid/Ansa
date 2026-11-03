package main

// The demo's finished calls and received emails (demo_inbox.go saves them),
// each with the answer the scripted brain gives core for it.

// demoCall is one finished call: who called, what was said (one turn a
// line) and the brain's decision.
type demoCall struct {
	caller     string
	transcript []string
	decision   string
}

var demoCalls = []demoCall{
	{"+880 1711 000101", []string{
		"AI: Thanks for calling Shapla Kitchen. How can I help you today?",
		"User: Hi, I'd like food for an office lunch on Thursday, about 35 people.",
		"AI: Lovely! For 20 guests or more our manager prepares a catering menu and a price. May I take your name?",
		"User: It's Mahbub from Delta Office. You can call me back on this number.",
		"AI: Thank you, Mahbub. Our manager will call you back today with a menu.",
	}, marshal(map[string]any{"outcome": "needs_human", "source": "model", "reason_code": "model_needs_human",
		"customer_issue": "Mahbub from Delta Office wants lunch for about 35 people on Thursday and asks to be called back.",
		"explanation":    "A catering order of this size needs the manager's menu and price.",
		"ticket_subject": "Office lunch for 35 people on Thursday", "category": "Catering", "resolution_evidence": nil})},
	{"+880 1811 000202", []string{
		"AI: Thanks for calling Shapla Kitchen. How can I help you today?",
		"User: Hi, are you open on Friday evening?",
		"AI: Yes, we're open every day, all day, and kacchi and biryani are ready from 12:00.",
		"User: Do we need to book a table for six people?",
		"AI: For six people, send us a message on WhatsApp and we keep the family room ready for you.",
		"User: Perfect, that answers my question. Thank you so much.",
		"AI: You're welcome. See you on Friday!",
	}, marshal(map[string]any{"outcome": "solved", "source": "model", "reason_code": "model_solved",
		"customer_issue": "Whether the restaurant is open on Friday evening, and booking a table for six.",
		"explanation":    "The assistant answered both questions and the caller confirmed.",
		"ticket_subject": nil, "category": nil, "resolution_evidence": "Perfect, that answers my question."})},
}

// demoEmail is one email forwarded to a demo account, and the brain's triage.
type demoEmail struct {
	name, address, subject, text, triage string
}

var demoEmails = []demoEmail{
	{"Lamia Chowdhury", "lamia.chowdhury@example.com", "Booking the family room for a birthday",
		"Hello,\n\nWe'd like to book your family room for my mother's 60th birthday on Saturday 15 November, about 18 people, at 7 pm. Can you arrange a set menu with kacchi and firni?\n\nThanks,\nLamia",
		triage("Family room for a 60th birthday, 18 people", "Lamia wants the family room on Saturday 15 November at 7 pm for 18 people, with a set menu of kacchi and firni.", "Catering")},
	{"Farzana Ahmed", "farzana@deltaoffice.example", "A monthly lunch account for our office",
		"Dear Shapla Kitchen,\n\nOur office of 25 people would like to order lunch every weekday. Do you offer a monthly account with one invoice?\n\nRegards,\nFarzana Ahmed\nDelta Office",
		triage("Weekday lunches for an office of 25, one monthly invoice", "Farzana from Delta Office asks for lunch every weekday for 25 people, paid on one monthly invoice.", "Orders")},
}

// Rafa's email: a client writing to the address he forwards.
var personEmails = []demoEmail{
	{"Lamia Chowdhury", "lamia@deltaoffice.example", "Logo files and the invoice",
		"Hi Rafa,\n\nCould you send the final logo files (SVG and PNG) by Thursday, and your invoice?\n\nThanks,\nLamia",
		triage("Final logo files and the invoice by Thursday", "Lamia asks for the final logo files (SVG and PNG) and the invoice by Thursday.", "")},
}

func triage(subject, summary, category string) string {
	return marshal(map[string]any{"kind": "ok", "subject": subject, "summary": summary, "category": category})
}
