package main

import "time"

// What already happened in the demo accounts (demo_history.go plays it).
// The restaurant's menu labels follow its menu's order (demo_setup.go):
// M1 Kacchi Biryani, M2 Chicken Biryani, M3 Morog Polao, M4 Beef Bhuna,
// M5 Rui Fish Curry, M6 Plain Rice, M7 Borhani, M8 Mango Lassi, M9 Firni,
// M10 Family Kacchi, M11 Shorshe Ilish, M12 Mishti Doi.

// Shapla Kitchen: a question answered, orders at every step (demoOrderSteps:
// done, accepted, on its way, cancelled, and Shakil's delivery waiting for the
// presenter to accept), a complaint and a
// catering request for a person (each its own category, so routed), ansa's
// checks stopping a made-up price and a refund promise, a booking the owner
// answered herself (taken over), and, in "Ask me first", a reply waiting for
// the owner. The practice chat's first customer (Tanvir) isn't one of them,
// so the live demo starts a new conversation.
var restaurantHistory = []demoChat{
	// Two days ago (restaurantDay): WhatsApp lets ansa reply only within 24
	// hours of the customer's last message, so its page says so instead of a
	// reply box.
	{channel: "whatsapp", name: "Shirin", turns: []demoTurn{
		{"Do you have a table for 8 on Friday?", reply("Yes! For 8 people we keep the family room ready on Friday. See you then!")},
	}},
	{channel: "whatsapp", name: "Rahim", turns: []demoTurn{
		{"Hi! What time do you open on Friday?", reply("We're open on Friday from 10:00 until midnight. Kacchi and biryani are ready from 12:00.")},
	}},
	{channel: "telegram", name: "Imran", turns: []demoTurn{
		{"Can I get 1 Chicken Biryani and 2 Borhani for pickup at 8 pm?", orderSummary("pickup", "", "20:00", "", "M2", 1, "M7", 2)},
		{"Yes please", orderConfirmed},
	}},
	{channel: "whatsapp", name: "Farhana", turns: []demoTurn{
		{"Do you have anything vegetarian?", reply("Our Plain Rice, Borhani, Mango Lassi and Firni are vegetarian. The biryanis and curries are made with meat or fish. Would you like to order something?")},
	}},
	{channel: "messenger", name: "Sara", turns: []demoTurn{
		{"My order last night arrived cold and very late. I'm really disappointed.",
			needsPerson("complaint", "Cold and late delivery", "Sara says her delivery last night arrived cold and very late.", "Complaints")},
	}},
	{channel: "telegram", name: "Nusrat", turns: []demoTurn{
		{"Do you do catering? We need food for about 150 guests at a wedding on 20 December.",
			needsPerson("asked_for_person", "Wedding catering for 150 guests", "Nusrat asks for catering for about 150 guests at a wedding on 20 December.", "Catering")},
	}},
	{channel: "whatsapp", name: "Shakil", turns: []demoTurn{
		{"2 Kacchi Biryani and 1 Mango Lassi, delivered to House 7, Road 12, Dhanmondi please", orderSummary("delivery", "House 7, Road 12, Dhanmondi", "", "", "M1", 2, "M8", 1)},
		{"Yes", orderConfirmed},
	}},
	{channel: "messenger", name: "Mitu", turns: []demoTurn{
		{"1 Morog Polao and 2 Firni for pickup at 7:30 pm please", orderSummary("pickup", "", "19:30", "", "M3", 1, "M9", 2)},
		{"Yes, thanks", orderConfirmed},
	}},
	{channel: "telegram", name: "Rakib", turns: []demoTurn{
		{"2 Beef Bhuna and 2 Plain Rice to Flat 4B, Road 8, Dhanmondi. Less spicy please!", orderSummary("delivery", "Flat 4B, Road 8, Dhanmondi", "", "Less spicy, please", "M4", 2, "M6", 2)},
		{"Yes", orderConfirmed},
	}},
	{channel: "whatsapp", name: "Shila", turns: []demoTurn{
		{"One Rui Fish Curry for pickup, please", orderSummary("pickup", "", "", "", "M5", 1)},
		{"Yes", orderConfirmed},
	}},
	// The AI writes a price that isn't on the menu: ansa doesn't send it.
	{channel: "whatsapp", name: "Jamal", turns: []demoTurn{
		{"Is kacchi cheaper today? My friend paid 250 taka.", reply("Yes! Kacchi Biryani is only BDT 250 today.")},
	}},
	// The AI promises a refund: ansa doesn't send it either.
	{channel: "messenger", name: "Sumi", turns: []demoTurn{
		{"The kacchi yesterday was much too salty.", reply("We're so sorry! We'll refund you in full today.")},
	}},
	{channel: "telegram", name: "Habib", ownerReply: "Hi Habib, it's Nadia: the family room is yours tonight at 8 pm. See you!", turns: []demoTurn{
		{"Is the family room free tonight for 8 people at 8 pm?", reply("Let me check with the team: they'll confirm the family room for tonight very soon.")},
	}},
	{channel: "telegram", name: "Rupa", askFirst: true, turns: []demoTurn{
		{"Do you deliver to Gulshan?", reply("Sorry, we deliver within 5 km of Dhanmondi, so Gulshan is too far for us. You're very welcome to pick up!")},
	}},
}

// When each conversation happened, before the reset: spread over the day,
// newest last (Home's "What ansa did" and the Inbox read like a real day).
var restaurantDay = map[string]time.Duration{
	"Shirin": 50 * time.Hour, "Rahim": 5 * time.Hour, "Imran": 4*time.Hour + 40*time.Minute, "Farhana": 4*time.Hour + 10*time.Minute,
	"Sara": 3*time.Hour + 50*time.Minute, "Nusrat": 3*time.Hour + 30*time.Minute, "Mitu": 3 * time.Hour, "Rakib": 2*time.Hour + 30*time.Minute,
	"Shila": 2*time.Hour + 10*time.Minute, "Jamal": 1*time.Hour + 50*time.Minute, "Sumi": 1*time.Hour + 30*time.Minute,
	"Habib": 1*time.Hour + 10*time.Minute, "Shakil": 25 * time.Minute, "Rupa": 15 * time.Minute,
}

// Rafa's night: away, while ansa answered for him.
var personNight = map[string]time.Duration{"Arif": 9 * time.Hour, "Maya": 6*time.Hour + 30*time.Minute, "Mum": 1*time.Hour + 20*time.Minute}

// How far each placed order has gone on the Orders page (the customer told
// each step); Shakil's waits for the presenter to accept it.
var demoOrderSteps = map[string][]string{
	"Imran": {"accept", "ready", "done"},
	"Mitu":  {"accept"},
	"Rakib": {"accept", "ready"},
	"Shila": {"cancel"},
}

// Rafa, away: a price answered from Rafa's own notes, a meeting moved to
// decide, and an important person passed straight on.
var personHistory = []demoChat{
	{channel: "whatsapp", name: "Arif", turns: []demoTurn{
		{"Hi Rafa, how much do you charge for a logo?", reply("Rafa's logos start at 15,000 taka and usually take about a week. Rafa will confirm the details for your project.")},
	}},
	{channel: "telegram", name: "Maya", turns: []demoTurn{
		{"Hi Rafa! Could we move tomorrow's call to 4 pm?",
			needsPerson("needs_decision", "Move tomorrow's call to 4 pm", "Maya asks to move tomorrow's call to 4 pm.", "")},
	}},
	{channel: "telegram", name: "Mum", important: true, turns: []demoTurn{
		{"Call me when you're free", ""},
	}},
}
