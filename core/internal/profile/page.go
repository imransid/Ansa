package profile

import (
	"context"
	"time"

	"ansa/core/internal/tenant"
)

// Page is the Profile page (the old BusinessProfile): every topic grouped
// as the page shows them, how complete the profile is, and the key topics
// with neither a confirmed value nor a proposal, in the interview's order.
type Page struct {
	Groups           []PageGroup  `json:"groups"`
	Completion       Completion   `json:"completion"`
	MissingKeyTopics []TopicLabel `json:"missingKeyTopics"`
}

// PageGroup is one group of topics.
type PageGroup struct {
	Group  string      `json:"group"`
	Label  string      `json:"label"`
	Topics []PageTopic `json:"topics"`
}

// PageTopic is one topic as the page shows it (every field named: the page
// gets what it shows, nothing else).
type PageTopic struct {
	Topic     string     `json:"topic"`
	Label     string     `json:"label"`
	IsKey     bool       `json:"isKey"`
	Confirmed *Confirmed `json:"confirmed"`
	Proposal  *Proposed  `json:"proposal"`
}

// Confirmed is a topic's confirmed value: what, from where, when, by whom.
type Confirmed struct {
	Value  string    `json:"value"`
	Source string    `json:"source"`
	At     time.Time `json:"at"`
	ByName *string   `json:"byName"`
}

// Proposed is the proposal waiting beside it.
type Proposed struct {
	Value  string    `json:"value"`
	Source string    `json:"source"`
	At     time.Time `json:"at"`
}

// TopicLabel names a topic.
type TopicLabel struct {
	Topic string `json:"topic"`
	Label string `json:"label"`
}

// ReadPage reads one company's Profile page.
func ReadPage(ctx context.Context, q Querier, company tenant.CompanyID) (Page, error) {
	rows, err := ReadRows(ctx, q, company)
	if err != nil {
		return Page{}, err
	}
	byTopic := map[string]Row{}
	for _, row := range rows {
		byTopic[row.Topic] = row
	}
	facts := factsOf(rows)
	page := Page{Completion: facts.Completion(), MissingKeyTopics: labelsOf(facts.MissingKeyTopics())}
	for _, group := range Groups {
		shown := PageGroup{Group: group.Key, Label: group.Label, Topics: []PageTopic{}}
		for _, topic := range Topics {
			if topic.Group == group.Key {
				shown.Topics = append(shown.Topics, pageTopic(topic, byTopic[topic.Key]))
			}
		}
		page.Groups = append(page.Groups, shown)
	}
	return page, nil
}

func pageTopic(topic Topic, row Row) PageTopic {
	shown := PageTopic{Topic: topic.Key, Label: topic.Label, IsKey: topic.IsKey}
	if row.ConfirmedValue != nil && row.ConfirmedSource != nil && row.ConfirmedAt != nil {
		shown.Confirmed = &Confirmed{Value: *row.ConfirmedValue, Source: *row.ConfirmedSource, At: *row.ConfirmedAt, ByName: row.ConfirmedByName}
	}
	if row.ProposedValue != nil && row.ProposedSource != nil && row.ProposedAt != nil {
		shown.Proposal = &Proposed{Value: *row.ProposedValue, Source: *row.ProposedSource, At: *row.ProposedAt}
	}
	return shown
}

// labelsOf names topics for a page.
func labelsOf(topics []Topic) []TopicLabel {
	labels := []TopicLabel{}
	for _, topic := range topics {
		labels = append(labels, TopicLabel{Topic: topic.Key, Label: topic.Label})
	}
	return labels
}
