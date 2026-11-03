package main

// The restaurant's marketing content (demo_marketing.go saves it). Its
// name, what it does and its address were confirmed by the setup.

// The other key facts, as an owner fills them in on the Profile page.
var demoFacts = [][2]string{
	{"industry", "Restaurant: home-style Bangladeshi food, eaten in, picked up or delivered."},
	{"products", "Kacchi biryani, chicken biryani, morog polao, beef bhuna, rui fish curry, borhani, mango lassi and firni."},
	{"services", "Dine-in for 40 guests, pickup, delivery within 5 km of Dhanmondi, and catering for 20 to 300 guests."},
	{"target_customers", "Families and office workers in Dhanmondi, and people planning weddings and office events."},
	{"customer_problems", "A home-style meal without cooking, lunch at the office on time, and food for a big family event."},
	{"value_proposition", "Kacchi cooked fresh every morning the old Dhaka way, fair prices, and a team that answers every message."},
	{"languages", "Bangla and English."},
	{"goals", "More weekday lunch orders from offices nearby, and three catering bookings a month."},
	{"brand_voice", "Warm and friendly, proud of home cooking, never pushy."},
	{"marketing_channels", "The Facebook Page, WhatsApp and word of mouth."},
	{"publishing_frequency", "Three posts a week."},
	{"competitors", "Other biryani houses in Dhanmondi, and the food delivery apps."},
	{"campaign_budget", "No paid campaigns yet; perhaps 5,000 taka a month to try."},
	{"content_preferences", "The kitchen at work, the dish of the day, and the families and events we cook for."},
}

// The plan the scripted brain writes (core checks it as any plan).
var demoPlan = map[string]any{
	"summary": "Grow weekday lunch orders from offices near Dhanmondi and book more catering, by showing home-style cooking and quick, friendly service on Facebook.",
	"audiences": []map[string]any{
		{"name": "Office workers in Dhanmondi", "needs": "A filling home-style lunch delivered on time", "where_to_reach": "Facebook and WhatsApp"},
		{"name": "Families nearby", "needs": "A weekend meal without cooking", "where_to_reach": "Facebook"},
		{"name": "Families planning weddings and events", "needs": "Reliable catering for 20 to 300 guests", "where_to_reach": "Facebook and word of mouth"},
	},
	"positioning": "The home-style kacchi of Dhanmondi: cooked fresh every morning, at fair prices, by a team that answers every message.",
	"goals": []map[string]any{
		{"goal": "More weekday lunch orders from offices nearby", "how_to_measure": "Lunch orders a week on the Orders page"},
		{"goal": "Three catering bookings a month", "how_to_measure": "Catering requests in the Inbox"},
	},
	"pillars": []map[string]any{
		{"name": "From our kitchen", "description": "The kitchen at work: kacchi cooked fresh every morning.", "example_topics": []string{"How we cook kacchi", "Morning in the kitchen"}},
		{"name": "Dish of the day", "description": "One dish and its price, to make ordering easy.", "example_topics": []string{"Morog polao today", "Rui fish curry"}},
		{"name": "Family and events", "description": "Weddings, office lunches and the families we cook for.", "example_topics": []string{"A wedding we cooked for", "Office lunch for a team"}},
	},
	"campaigns": []map[string]any{
		{"name": "Office lunch weeks", "objective": "Weekday lunch orders from offices nearby", "pillar": "Dish of the day", "platforms": []string{"facebook"}, "timing": "Weekdays at 11:00", "call_to_action": "Order on WhatsApp"},
		{"name": "Wedding season catering", "objective": "Catering requests for winter weddings", "pillar": "Family and events", "platforms": []string{"facebook", "linkedin"}, "timing": "November to February", "call_to_action": "Message us for a catering menu"},
	},
	"cadence": []map[string]any{
		{"platform": "facebook", "posts_per_week": 3, "formats": []string{"post", "image_post"}},
		{"platform": "linkedin", "posts_per_week": 1, "formats": []string{"post"}},
	},
	"statements": []map[string]any{
		{"text": "Families and office workers nearby are the main customers.", "basis": "fact", "fact_topics": []string{"target_customers"}},
		{"text": "Kacchi cooked fresh every morning sets the restaurant apart.", "basis": "fact", "fact_topics": []string{"value_proposition"}},
		{"text": "Posts at 11:00 on weekdays reach people deciding on lunch.", "basis": "assumption", "fact_topics": []string{}},
		{"text": "Try a small paid boost for the catering campaign once posts get reactions.", "basis": "suggestion", "fact_topics": []string{"campaign_budget"}},
	},
	"missing_information": []string{"How many orders a week come from offices today"},
	"cautions":            []string{"Check every price in a post against the menu before it goes out."},
}

// demoPost is one post and the step it is at: "idea", "draft",
// "approved", "scheduled" (tomorrow) or "published" (now).
type demoPost struct {
	platform, step, topic, pillar, body, callToAction string
	hashtags                                          []string
}

var demoPosts = []demoPost{
	{"facebook", "published", "Kacchi cooked fresh every morning", "From our kitchen",
		"Every morning at 9 our kitchen starts the kacchi: mutton, rice and potatoes cooked together the old Dhaka way. It's ready from 12:00. Come hungry!", "Order on WhatsApp", []string{"kacchi", "dhanmondi"}},
	{"facebook", "published", "Morog polao today", "Dish of the day",
		"Today's dish: Morog Polao, chicken with fragrant rice, BDT 380. A perfect long lunch.", "Order on WhatsApp", []string{"morogpolao"}},
	{"facebook", "published", "Lunch at the office", "Dish of the day",
		"Busy day at the office? We deliver within 5 km of Dhanmondi in about 45 minutes, hot and home-style.", "Order on WhatsApp", []string{"officelunch", "dhanmondi"}},
	{"facebook", "published", "A wedding we cooked for", "Family and events",
		"Last weekend we cooked for a family wedding of 180 guests in Dhanmondi. Thank you for trusting our kacchi with your big day! Planning an event? Ask us for a catering menu.", "Message us for a catering menu", []string{"weddingcatering"}},
	{"facebook", "published", "Mango lassi is back", "Dish of the day",
		"Our Mango Lassi is back: cold, thick and made fresh every day. The perfect partner for a spicy Beef Bhuna.", "Order on WhatsApp", []string{"mangolassi"}},
	{"linkedin", "scheduled", "Catering for office events", "Family and events",
		"Planning a team lunch or an office event in Dhanmondi? Shapla Kitchen caters for 20 to 300 guests with home-style Bangladeshi food. Message us and our manager calls back within a day.", "Message us for a catering menu", []string{"catering", "dhaka"}},
	{"facebook", "approved", "Friday family lunch", "Family and events",
		"Fridays are for family. Bring everyone for kacchi, borhani and firni: we keep the family room upstairs ready for you.", "Book a table on WhatsApp", []string{"fridaylunch"}},
	{"facebook", "draft", "Rui fish curry, home style", "Dish of the day",
		"Rui Fish Curry the way it's cooked at home: tomato, a little green chilli, and rice on the side.", "Order on WhatsApp", nil},
	{"facebook", "idea", "Behind the scenes with our cooks", "From our kitchen", "", "", nil},
}

// Numbers for the published posts, as the platform would report them
// (development: simulated, and marked so on the Analytics page).
var demoNumbers = [][]string{
	{"views=1840", "reactions=132", "comments=18", "shares=11"},
	{"views=960", "reactions=64", "comments=7", "shares=3"},
	{"views=1210", "reactions=88", "comments=9", "shares=6"},
	{"views=2650", "reactions=241", "comments=37", "shares=29"},
	{"views=1430", "reactions=97", "comments=12", "shares=8"},
}
