// Package strategy is the Co-Founder's marketing plan (the old
// lib/marketing-plan/, db/marketing-plans.ts, db/support-trends.ts,
// db/cofounder-settings.ts and services/marketing-plan*.ts,
// marketing-strategy.ts): versions made from the owner's confirmed facts
// by the brain, checked by core, numbered under the company row lock and
// never deleted; the Strategy page; and the support-trends setting.
package strategy

// Plan is a marketing plan, as the AI writes it and as marketing_plans.plan
// stores it: the same keys, so a stored plan is read back with the same
// reader (ReadPlan). There is deliberately no company, person or version
// field: the AI can't choose what its plan belongs to.
type Plan struct {
	Summary            string      `json:"summary"`
	Audiences          []Audience  `json:"audiences"`
	Positioning        string      `json:"positioning"`
	Goals              []Goal      `json:"goals"`
	Pillars            []Pillar    `json:"pillars"`
	Campaigns          []Campaign  `json:"campaigns"`
	Cadence            []Cadence   `json:"cadence"`
	Statements         []Statement `json:"statements"`
	MissingInformation []string    `json:"missing_information"`
	Cautions           []string    `json:"cautions"`
}

// Audience is one group of customers the plan speaks to.
type Audience struct {
	Name         string `json:"name"`
	Needs        string `json:"needs"`
	WhereToReach string `json:"where_to_reach"`
}

// Goal is what to aim for, and what to count to see whether it works.
type Goal struct {
	Goal         string `json:"goal"`
	HowToMeasure string `json:"how_to_measure"`
}

// Pillar is one content pillar.
type Pillar struct {
	Name          string   `json:"name"`
	Description   string   `json:"description"`
	ExampleTopics []string `json:"example_topics"`
}

// Campaign is one campaign; Pillar names one of the plan's pillars.
type Campaign struct {
	Name         string   `json:"name"`
	Objective    string   `json:"objective"`
	Pillar       string   `json:"pillar"`
	Platforms    []string `json:"platforms"`
	Timing       string   `json:"timing"`
	CallToAction string   `json:"call_to_action"`
}

// Cadence is how often to post on one platform (one decimal).
type Cadence struct {
	Platform     string   `json:"platform"`
	PostsPerWeek float64  `json:"posts_per_week"`
	Formats      []string `json:"formats"`
}

// Statement is one main point of the plan with its basis: "fact" (it only
// repeats confirmed facts, named in FactTopics), "assumption" or "suggestion".
type Statement struct {
	Text       string   `json:"text"`
	Basis      string   `json:"basis"`
	FactTopics []string `json:"fact_topics"`
}

// Platforms are the ones a plan may name (the platforms ansa connects).
var Platforms = []string{"linkedin", "facebook", "x", "youtube"}

// PlatformLabels name them for people and for the AI.
var PlatformLabels = map[string]string{"linkedin": "LinkedIn", "facebook": "Facebook", "x": "X", "youtube": "YouTube"}

// The most posts a week a cadence may plan on one platform.
const postsPerWeekMax = 14

// listLimits are the fewest entries a usable plan needs and the most kept.
type listLimits struct{ min, max int }

// The list sizes (the old PLAN_LIST_LIMITS): the AI is told them, and a
// plan without its fewest is not saved; entries past the most are left out.
var (
	audienceLimits     = listLimits{1, 5}
	goalLimits         = listLimits{1, 6}
	pillarLimits       = listLimits{3, 6}
	exampleTopicLimits = listLimits{1, 6}
	campaignLimits     = listLimits{1, 6}
	cadenceLimits      = listLimits{1, 4}
	formatLimits       = listLimits{0, 5}
	statementLimits    = listLimits{1, 20}
	factTopicLimits    = listLimits{0, 5}
	missingInfoLimits  = listLimits{0, 10}
	cautionLimits      = listLimits{0, 10}
)

// ApplyFactBasisRule keeps "Fact" honest: the AI labels each statement,
// but only this code can check it against the profile. A "fact" counts
// only when it names facts and every one was among the confirmed facts
// sent; otherwise it is an assumption. Each statement then names only
// topics that were sent. Runs on save AND on every read of a stored plan.
func ApplyFactBasisRule(plan *Plan, sentTopics map[string]bool) {
	for index, statement := range plan.Statements {
		everySent := len(statement.FactTopics) > 0
		kept := []string{}
		for _, topic := range statement.FactTopics {
			if !sentTopics[topic] {
				everySent = false
				continue
			}
			if len(kept) < factTopicLimits.max {
				kept = append(kept, topic)
			}
		}
		if statement.Basis == "fact" && !everySent {
			plan.Statements[index].Basis = "assumption"
		}
		plan.Statements[index].FactTopics = kept
	}
}
