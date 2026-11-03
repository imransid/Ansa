// Package packages is ansa's packages (step 57): what each one costs and
// includes, in THIS ONE FILE (change a name, a price or a limit here and
// everything follows: the limits, the Billing page, Home), and which one a
// company has now. Usage is counted per calendar month (usage.go).
package packages

// Package is one of ansa's packages.
type Package struct {
	// "trial", "personal", "business", "pro", or "none" (the free trial
	// ended and nothing was chosen).
	Key  string `json:"key"`
	Name string `json:"name"`
	// US dollars a month (0: the free trial, or none).
	PriceUSD int `json:"priceUsd"`
	// What one calendar month includes: replies written with ansa's AI
	// (chats, emails read, "Post for me" posts; a business's own Claude
	// key's aren't counted) and minutes of calls answered live.
	AIReplies   int `json:"aiReplies"`
	CallMinutes int `json:"callMinutes"`
	// People with a login on the team, pending invites counted.
	TeamMembers int `json:"teamMembers"`
	// The assistant takes orders (a business that takes them).
	Orders bool `json:"orders"`
	// Customers' Facebook Messenger messages answered.
	Messenger bool `json:"messenger"`
	// "Post for me": "none", "three_a_week" (three a week or weekly) or
	// "daily" (any).
	PostForMe string `json:"postForMe"`
}

// The free trial lasts this long from signup, with no card.
const TrialDays = 14

// The packages. Prices and limits were chosen on 2026-11-03 (step 57): one
// AI reply costs ansa about $0.012-0.015 with Claude Sonnet 5.5 and one
// call minute about $0.10, so each package pays for itself even used in full.
var (
	Trial    = Package{Key: "trial", Name: "Free trial", PriceUSD: 0, AIReplies: 150, CallMinutes: 15, TeamMembers: 3, Orders: true, Messenger: true, PostForMe: "three_a_week"}
	Personal = Package{Key: "personal", Name: "Personal", PriceUSD: 10, AIReplies: 300, CallMinutes: 20, TeamMembers: 1, Orders: false, Messenger: false, PostForMe: "none"}
	Business = Package{Key: "business", Name: "Business", PriceUSD: 29, AIReplies: 1_000, CallMinutes: 60, TeamMembers: 3, Orders: true, Messenger: true, PostForMe: "three_a_week"}
	Pro      = Package{Key: "pro", Name: "Pro", PriceUSD: 79, AIReplies: 3_000, CallMinutes: 200, TeamMembers: 10, Orders: true, Messenger: true, PostForMe: "daily"}
	// The free trial ended and nothing was chosen: ansa still receives
	// everything and sends holding replies, but writes nothing with the AI.
	None = Package{Key: "none", Name: "No package", TeamMembers: 1, PostForMe: "none"}
)

// Paid is what a company can choose, in the order the Billing page shows.
var Paid = []Package{Personal, Business, Pro}

// ByKey is a paid package by its key (false: not one of them).
func ByKey(key string) (Package, bool) {
	for _, p := range Paid {
		if p.Key == key {
			return p, true
		}
	}
	return Package{}, false
}

// AllowsPosting: whether "Post for me" may post at this frequency
// ("daily", "three_a_week" or "weekly").
func (p Package) AllowsPosting(frequency string) bool {
	switch p.PostForMe {
	case "daily":
		return true
	case "three_a_week":
		return frequency == "three_a_week" || frequency == "weekly"
	}
	return false
}

// AnswersComments: whether ansa answers comments on the business's Facebook
// posts. They come with Messenger: an answer may be a Messenger message
// (Meta's private reply), and the conversation goes on there.
func (p Package) AnswersComments() bool {
	return p.Messenger
}
