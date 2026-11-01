package drafts

// The business profile's topics, in the interview's order (the old
// lib/business-facts.ts): what a draft is written from and what its claims
// name. Only the keys and labels the content studio needs.

// Topic is one topic of the profile.
type Topic struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

// Topics are the profile's 25 topics, in order.
var Topics = []Topic{
	{"company_name", "Business name"}, {"description", "What the business does"}, {"industry", "Industry"},
	{"products", "Products"}, {"services", "Services"}, {"target_customers", "Target customers"},
	{"customer_problems", "Customer problems"}, {"value_proposition", "Why customers choose you"},
	{"location", "Location"}, {"languages", "Languages"}, {"goals", "Marketing goals"}, {"brand_voice", "Brand voice"},
	{"marketing_channels", "Marketing channels"}, {"publishing_frequency", "Publishing frequency"},
	{"competitors", "Competitors"}, {"campaign_budget", "Campaign budget"}, {"website", "Website"}, {"prices", "Prices"},
	{"offers_promotions", "Offers and promotions"}, {"policies", "Policies"}, {"positioning", "Positioning"},
	{"social_accounts", "Social media accounts"}, {"content_preferences", "Content preferences"},
	{"visual_identity", "Visual identity"}, {"words_to_avoid", "Words to avoid"},
}

// TopicLabel is a topic's label, or the key itself for one this code
// doesn't know.
func TopicLabel(key string) string {
	for _, topic := range Topics {
		if topic.Key == key {
			return topic.Label
		}
	}
	return key
}

// IsTopic says whether a key is one of the profile's topics.
func IsTopic(key string) bool {
	for _, topic := range Topics {
		if topic.Key == key {
			return true
		}
	}
	return false
}

// Fact is one confirmed fact: as a request held it (content_drafts.
// facts_used), or as the profile holds it now.
type Fact struct {
	Topic string `json:"topic"`
	Value string `json:"value"`
}

// OrderedFacts are the confirmed facts in the topics' order, empty values
// left out: the order a draft's request sends them in.
func OrderedFacts(byTopic map[string]string) []Fact {
	facts := []Fact{}
	for _, topic := range Topics {
		if value := byTopic[topic.Key]; value != "" {
			facts = append(facts, Fact{Topic: topic.Key, Value: value})
		}
	}
	return facts
}

// What the AI needs confirmed before it writes anything (the old
// plan-readiness.ts): any one topic of each.
var neededForTheAI = []struct {
	label  string
	topics []string
}{
	{"What the business does", []string{"description"}},
	{"Products or services", []string{"products", "services"}},
	{"Target customers", []string{"target_customers"}},
}

// MissingForTheAI are the labels of what still needs confirming before the
// AI may write a draft (none: it may).
func MissingForTheAI(byTopic map[string]string) []string {
	missing := []string{}
	for _, needed := range neededForTheAI {
		found := false
		for _, topic := range needed.topics {
			found = found || byTopic[topic] != ""
		}
		if !found {
			missing = append(missing, needed.label)
		}
	}
	return missing
}
