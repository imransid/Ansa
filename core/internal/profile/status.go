package profile

// Where a profile stands (the old lib/cofounder/profile-status.ts): each
// topic's status, what is still missing, how complete it is. Pure, so the
// interview, the pages and the tests all count the same way.

// Values is what the profile holds for one topic: the confirmed value and
// the proposal waiting beside it ("" = none).
type Values struct {
	Confirmed string
	Proposed  string
}

// Facts are a company's values by topic key (a topic without a row is missing).
type Facts map[string]Values

// A topic's status: confirmed (a proposal may wait beside it), proposed
// (only a proposal, waiting for an owner), or missing (neither).
const (
	StatusConfirmed = "confirmed"
	StatusProposed  = "proposed"
	StatusMissing   = "missing"
)

// Completion is "12 of 16 key facts confirmed", and the proposals waiting.
type Completion struct {
	KeyConfirmed     int `json:"keyConfirmed"`
	KeyTotal         int `json:"keyTotal"`
	ProposalsWaiting int `json:"proposalsWaiting"`
}

// StatusOf is one topic's status.
func (f Facts) StatusOf(key string) string {
	values := f[key]
	if values.Confirmed != "" {
		return StatusConfirmed
	}
	if values.Proposed != "" {
		return StatusProposed
	}
	return StatusMissing
}

// FirstMissingKeyTopic is the first key topic, in the interview's order,
// with neither a confirmed value nor a proposal (ok false: none). A
// proposal counts as answered: the owner only has to confirm it.
func (f Facts) FirstMissingKeyTopic() (Topic, bool) {
	for _, topic := range KeyTopics() {
		if f.StatusOf(topic.Key) == StatusMissing {
			return topic, true
		}
	}
	return Topic{}, false
}

// MissingKeyTopics are every key topic with neither value nor proposal.
func (f Facts) MissingKeyTopics() []Topic {
	missing := []Topic{}
	for _, topic := range KeyTopics() {
		if f.StatusOf(topic.Key) == StatusMissing {
			missing = append(missing, topic)
		}
	}
	return missing
}

// Completion counts the key facts an owner confirmed, and the proposals
// waiting. Only a confirmed value counts as known: a proposal is the AI's
// reading of what the owner said, not yet the owner's word.
func (f Facts) Completion() Completion {
	c := Completion{KeyTotal: len(KeyTopics())}
	for _, topic := range Topics {
		if topic.IsKey && f.StatusOf(topic.Key) == StatusConfirmed {
			c.KeyConfirmed++
		}
		if f[topic.Key].Proposed != "" {
			c.ProposalsWaiting++
		}
	}
	return c
}

// WithProposals is the profile as it will be once these proposals are
// saved: each topic proposed gets a proposal (its confirmed value stays).
// For deciding the interview's next step before the save.
func (f Facts) WithProposals(proposals []Proposal) Facts {
	next := Facts{}
	for key, values := range f {
		next[key] = values
	}
	for _, proposal := range proposals {
		next[proposal.Topic] = Values{Confirmed: f[proposal.Topic].Confirmed, Proposed: proposal.Value}
	}
	return next
}

// ConfirmedTopics are the topics with a confirmed value.
func (f Facts) ConfirmedTopics() map[string]bool {
	confirmed := map[string]bool{}
	for key, values := range f {
		if values.Confirmed != "" {
			confirmed[key] = true
		}
	}
	return confirmed
}
