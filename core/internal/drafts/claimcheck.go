package drafts

import "encoding/json"

// ReadStoredClaims reads content_drafts.claims; fits=false when it isn't
// a list of claims (then nobody can say which are backed: the owner checks).
func ReadStoredClaims(stored json.RawMessage) (claims []StoredClaim, fits bool) {
	var raw []storedClaim
	if json.Unmarshal(stored, &raw) != nil || raw == nil {
		return nil, false
	}
	for _, claim := range raw {
		if claim.Text == nil || claim.Supported == nil || claim.FactTopics == nil {
			return nil, false
		}
		claims = append(claims, StoredClaim{Text: *claim.Text, Supported: *claim.Supported, FactTopics: *claim.FactTopics})
	}
	return claims, true
}

// ReadFactsUsed reads content_drafts.facts_used in its order; anything
// else reads as none.
func ReadFactsUsed(stored json.RawMessage) []Fact {
	var raw []factUsed
	if json.Unmarshal(stored, &raw) != nil {
		return []Fact{}
	}
	facts := []Fact{}
	for _, fact := range raw {
		if fact.Topic == nil || fact.Value == nil {
			return []Fact{}
		}
		facts = append(facts, Fact{Topic: *fact.Topic, Value: *fact.Value})
	}
	return facts
}

// CheckClaims checks each stored claim again against the facts the draft
// was written from and the confirmed facts now.
func CheckClaims(stored []StoredClaim, factsUsed []Fact, factsNow map[string]string) []CheckedClaim {
	sent := map[string]string{}
	for _, fact := range factsUsed {
		sent[fact.Topic] = fact.Value
	}
	checked := []CheckedClaim{}
	for _, claim := range stored {
		facts := []ClaimFact{}
		for _, topic := range claim.FactTopics {
			fact := ClaimFact{Topic: topic, Label: TopicLabel(topic)}
			if value, wasSent := sent[topic]; wasSent {
				fact.Value = &value
			}
			facts = append(facts, fact)
		}
		checked = append(checked, CheckedClaim{Text: claim.Text, Status: claimStatus(claim, sent, factsNow), Facts: facts})
	}
	return checked
}

func claimStatus(claim StoredClaim, sent, now map[string]string) string {
	if len(claim.FactTopics) == 0 {
		return ClaimNoFact
	}
	for _, topic := range claim.FactTopics {
		if _, wasSent := sent[topic]; !wasSent || !claim.Supported {
			return ClaimFactNotConfirmed
		}
	}
	for _, topic := range claim.FactTopics {
		if value, confirmed := now[topic]; !confirmed || value != sent[topic] {
			return ClaimFactChanged
		}
	}
	return ClaimBacked
}

// MarkClaims marks the claims the AI listed (the old markClaims): a claim
// is supported only when it names facts and every one was among the
// confirmed topics sent. Each keeps the names that are profile topics,
// sent or not, so the page can say which one wasn't confirmed.
func MarkClaims(claims []StoredClaim, sentTopics map[string]bool) []StoredClaim {
	marked := []StoredClaim{}
	for _, claim := range claims {
		named := uniqueStrings(claim.FactTopics)
		supported := len(named) > 0
		known := []string{}
		for _, topic := range named {
			supported = supported && sentTopics[topic]
			if IsTopic(topic) {
				known = append(known, topic)
			}
		}
		marked = append(marked, StoredClaim{Text: claim.Text, Supported: supported, FactTopics: known})
	}
	return marked
}

func uniqueStrings(list []string) []string {
	seen := map[string]bool{}
	unique := []string{}
	for _, entry := range list {
		if !seen[entry] {
			seen[entry] = true
			unique = append(unique, entry)
		}
	}
	return unique
}
