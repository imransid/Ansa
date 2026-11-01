package strategy

// What a plan can't be made without (the old plan-readiness.ts): what the
// business does, what it sells (products or services: either is enough)
// and who it sells to. Only confirmed facts count: a proposal is the AI's
// reading of an answer, not yet the owner's word. Without them the AI is
// never asked. Pure.

// MissingFact is one thing a plan still needs, and the topics that would
// fill it (any one of them does).
type MissingFact struct {
	Label  string   `json:"label"`
	Topics []string `json:"topics"`
}

var neededForAPlan = []MissingFact{
	{Label: "What the business does", Topics: []string{"description"}},
	{Label: "Products or services", Topics: []string{"products", "services"}},
	{Label: "Target customers", Topics: []string{"target_customers"}},
}

// MissingForPlan is what is still missing, in the order above (none: ready).
func MissingForPlan(confirmedTopics map[string]bool) []MissingFact {
	missing := []MissingFact{}
	for _, needed := range neededForAPlan {
		filled := false
		for _, topic := range needed.Topics {
			filled = filled || confirmedTopics[topic]
		}
		if !filled {
			missing = append(missing, needed)
		}
	}
	return missing
}
