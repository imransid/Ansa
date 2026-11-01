package strategy

// The plan as given: pointers, so a missing field (or null) shows.
type rawPlan struct {
	Summary            *string         `json:"summary"`
	Audiences          *[]rawAudience  `json:"audiences"`
	Positioning        *string         `json:"positioning"`
	Goals              *[]rawGoal      `json:"goals"`
	Pillars            *[]rawPillar    `json:"pillars"`
	Campaigns          *[]rawCampaign  `json:"campaigns"`
	Cadence            *[]rawCadence   `json:"cadence"`
	Statements         *[]rawStatement `json:"statements"`
	MissingInformation *[]*string      `json:"missing_information"`
	Cautions           *[]*string      `json:"cautions"`
}

type rawAudience struct {
	Name         *string `json:"name"`
	Needs        *string `json:"needs"`
	WhereToReach *string `json:"where_to_reach"`
}

type rawGoal struct {
	Goal         *string `json:"goal"`
	HowToMeasure *string `json:"how_to_measure"`
}

type rawPillar struct {
	Name          *string    `json:"name"`
	Description   *string    `json:"description"`
	ExampleTopics *[]*string `json:"example_topics"`
}

type rawCampaign struct {
	Name         *string    `json:"name"`
	Objective    *string    `json:"objective"`
	Pillar       *string    `json:"pillar"`
	Platforms    *[]*string `json:"platforms"`
	Timing       *string    `json:"timing"`
	CallToAction *string    `json:"call_to_action"`
}

type rawCadence struct {
	Platform     *string    `json:"platform"`
	PostsPerWeek *float64   `json:"posts_per_week"`
	Formats      *[]*string `json:"formats"`
}

type rawStatement struct {
	Text       *string    `json:"text"`
	Basis      *string    `json:"basis"`
	FactTopics *[]*string `json:"fact_topics"`
}
