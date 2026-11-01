package drafts

import "ansa/core/internal/profile"

// The business profile's topics, in the interview's order (the old
// lib/business-facts.ts): what a draft is written from and what its claims
// name. Only the keys and labels the content studio needs.

// Topic is one topic of the profile.
type Topic struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

// Topics are the profile's 25 topics, in order: the business profile's
// own list (core/internal/profile), never a copy that could drift.
var Topics = func() []Topic {
	topics := make([]Topic, 0, len(profile.Topics))
	for _, topic := range profile.Topics {
		topics = append(topics, Topic{Key: topic.Key, Label: topic.Label})
	}
	return topics
}()

// TopicLabel is a topic's label, or the key itself for one this code
// doesn't know.
func TopicLabel(key string) string {
	return profile.LabelOf(key)
}

// IsTopic says whether a key is one of the profile's topics.
func IsTopic(key string) bool {
	_, known := profile.FindTopic(key)
	return known
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
