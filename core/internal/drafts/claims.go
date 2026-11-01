package drafts

import "encoding/json"

// storedClaim is one claim as content_drafts.claims stores it. Pointers:
// a claim missing a field doesn't fit the shape.
type storedClaim struct {
	Text       *string   `json:"text"`
	Supported  *bool     `json:"supported"`
	FactTopics *[]string `json:"fact_topics"`
}

type factUsed struct {
	Topic *string `json:"topic"`
	Value *string `json:"value"`
}

// ClaimsChecked: no owner needs to check this text's claims (the old
// reviewDraft's acknowledgmentNeeded, negated). The AI listed the claims
// of exactly this text (generated_version = version: no hand edit since),
// they fit the stored shape, and each names confirmed facts that were sent
// with the request and still say the same now. A draft "Post for me" wrote
// lists none: ansa's own checks of its text replace them.
func ClaimsChecked(d Draft, factsNow map[string]string) bool {
	if d.GeneratedVersion == nil || *d.GeneratedVersion != d.Version {
		return false
	}
	var claims []storedClaim
	if err := json.Unmarshal(d.Claims, &claims); err != nil {
		return false
	}
	sent := factsSent(d.FactsUsed)
	for _, claim := range claims {
		if claim.Text == nil || claim.Supported == nil || claim.FactTopics == nil {
			return false
		}
		if !*claim.Supported || len(*claim.FactTopics) == 0 {
			return false
		}
		for _, topic := range *claim.FactTopics {
			value, wasSent := sent[topic]
			if !wasSent || factsNow[topic] != value {
				return false
			}
		}
	}
	return true
}

// factsSent reads content_drafts.facts_used; anything else reads as none.
func factsSent(stored json.RawMessage) map[string]string {
	var facts []factUsed
	sent := map[string]string{}
	if json.Unmarshal(stored, &facts) != nil {
		return sent
	}
	for _, fact := range facts {
		if fact.Topic == nil || fact.Value == nil {
			return map[string]string{}
		}
		sent[*fact.Topic] = *fact.Value
	}
	return sent
}
