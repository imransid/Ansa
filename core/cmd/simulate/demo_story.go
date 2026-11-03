package main

// What already happened in the demo accounts (demo_history.go plays it).
// The restaurant's menu labels follow its menu's order (demo_setup.go):
// M1 Kacchi Biryani, M2 Chicken Biryani, M3 Morog Polao, M4 Beef Bhuna,
// M5 Rui Fish Curry, M6 Plain Rice, M7 Borhani, M8 Mango Lassi, M9 Firni.

// Shapla Kitchen: a question answered, a pickup order (done below), a
// delivery order waiting for the presenter to accept, a complaint and a
// catering request for a person (each its own category, so routed).
var restaurantHistory = []demoChat{
	{channel: "whatsapp", name: "Rahim", turns: []demoTurn{
		{"Hi! What time do you open on Friday?", reply("We're open on Friday from 10:00 until midnight. Kacchi and biryani are ready from 12:00.")},
	}},
	{channel: "telegram", name: "Imran", turns: []demoTurn{
		{"Can I get 1 Chicken Biryani and 2 Borhani for pickup at 8 pm?", orderSummary("pickup", "", "20:00", "M2", 1, "M7", 2)},
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
	{channel: "whatsapp", name: "Tanvir", turns: []demoTurn{
		{"2 Kacchi Biryani and 1 Mango Lassi, delivered to House 7, Road 12, Dhanmondi please", orderSummary("delivery", "House 7, Road 12, Dhanmondi", "", "M1", 2, "M8", 1)},
		{"Yes", orderConfirmed},
	}},
}

// Whose pickup order is already done (the customer told each step).
const doneOrderCustomer = "Imran"

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
