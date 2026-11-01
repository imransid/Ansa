// Package profile is a company's business profile and the interview that
// fills it (the old lib/business-facts.ts, lib/cofounder/, db/business-fact*.ts,
// db/onboarding-messages.ts and services/business-profile.ts,
// onboarding-*.ts, fact-suggestions.ts): what ansa knows about the business,
// topic by topic. A value an owner confirmed, and beside it a proposal the
// AI made from the interview or a knowledge article. A proposal NEVER
// overwrites a confirmed value: only an owner's Confirm makes it the fact.
package profile

// Topic is one topic of the profile.
type Topic struct {
	Key   string `json:"topic"`
	Label string `json:"label"`
	Group string `json:"-"`
	// A key fact: the profile counts as complete once every one is confirmed.
	IsKey bool `json:"isKey"`
	// What the interview asks without the AI: one plain question.
	Question string `json:"-"`
}

// Topics in the interview's order (the database's CHECK lists the same keys):
// the fixed question asked when the AI can't read an answer is the one of
// the first key topic still missing.
var Topics = []Topic{
	{"company_name", "Business name", "company", true, "What name do your customers know the business by?"},
	{"description", "What the business does", "company", true, "In a sentence or two, what does your business do?"},
	{"industry", "Industry", "company", true, "Which industry or field would you say the business is in?"},
	{"products", "Products", "offer", true, "Which products do you sell? If you only offer services, just say so."},
	{"services", "Services", "offer", true, "Which services do you offer? If you only sell products, just say so."},
	{"target_customers", "Target customers", "customers", true, "Who are your typical customers?"},
	{"customer_problems", "Customer problems", "customers", true, "What problems do customers come to you to solve?"},
	{"value_proposition", "Why customers choose you", "customers", true, "Why do customers choose you over the alternatives?"},
	{"location", "Location", "company", true, "Where is the business based, and where do you serve customers?"},
	{"languages", "Languages", "brand", true, "Which languages do you speak with your customers?"},
	{"goals", "Marketing goals", "marketing", true, "What should marketing achieve for the business in the next few months?"},
	{"brand_voice", "Brand voice", "brand", true, "How should the business sound when it talks to customers: for example friendly, expert or playful?"},
	{"marketing_channels", "Marketing channels", "marketing", true, "Where do you market the business today, or want to: for example Instagram, LinkedIn, email or local press?"},
	{"publishing_frequency", "Publishing frequency", "marketing", true, "How often could you realistically publish something new?"},
	{"competitors", "Competitors", "market", true, "Who are your main competitors? If you don't know of any, just say so."},
	{"campaign_budget", "Campaign budget", "marketing", true, "Do you have a budget for paid campaigns, and if so roughly how much a month?"},
	{"website", "Website", "company", false, "What is the address of your website, if you have one?"},
	{"prices", "Prices", "offer", false, "What do your main products or services cost?"},
	{"offers_promotions", "Offers and promotions", "offer", false, "Are there any offers or promotions running or planned?"},
	{"policies", "Policies", "offer", false, "Which policies should customers know about: for example returns, delivery or cancellations?"},
	{"positioning", "Positioning", "market", false, "How do you want people to see the business compared with others in your field?"},
	{"social_accounts", "Social media accounts", "marketing", false, "Which social media accounts does the business have?"},
	{"content_preferences", "Content preferences", "marketing", false, "What kind of posts would you like to publish: for example tips, behind the scenes or customer stories?"},
	{"visual_identity", "Visual identity", "brand", false, "How would you describe the look of the business: colors, logo and style?"},
	{"words_to_avoid", "Words to avoid", "brand", false, "Are there words, topics or claims the business should never use?"},
}

// Group is one group of the Profile page, in the page's order.
type Group struct {
	Key   string
	Label string
}

// Groups as the Profile page shows them.
var Groups = []Group{
	{"company", "The business"},
	{"offer", "What you sell"},
	{"customers", "Customers"},
	{"market", "Market"},
	{"brand", "Brand"},
	{"marketing", "Marketing"},
}

// Where a confirmed value came from, and where a waiting proposal came from.
const (
	SourceInterview = "interview"
	SourceKnowledge = "knowledge"
	SourceOwner     = "owner"
)

// FindTopic is the topic of a key (ok false: not one of ours).
func FindTopic(key string) (Topic, bool) {
	for _, topic := range Topics {
		if topic.Key == key {
			return topic, true
		}
	}
	return Topic{}, false
}

// LabelOf is a topic's label; a key the code no longer lists (read back
// from a stored plan) shows as itself.
func LabelOf(key string) string {
	if topic, ok := FindTopic(key); ok {
		return topic.Label
	}
	return key
}

// KeyTopics are the key topics in the interview's order.
func KeyTopics() []Topic {
	var keys []Topic
	for _, topic := range Topics {
		if topic.IsKey {
			keys = append(keys, topic)
		}
	}
	return keys
}
