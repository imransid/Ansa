package strategy

import (
	"bytes"
	"encoding/json"
	"math"

	"ansa/core/internal/plaintext"
)

// ReadPlan reads a plan: the brain's answer, or a stored one (the old
// plan-schema.ts and plan-answer.ts, one reader for both). Strict: a
// field missing, unknown or of another type, an unknown platform or basis,
// a cadence out of range or a list below its fewest makes it unusable
// (false). Texts become one plain line cut at a word with "..." (never
// refused for their length: a model can't count characters), lists keep
// their first entries, posts a week are rounded to one decimal, and blank,
// repeated or zero entries drop. Then the fact rule, against sentTopics.
func ReadPlan(raw []byte, sentTopics map[string]bool) (*Plan, bool) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var given rawPlan
	if decoder.Decode(&given) != nil || decoder.More() {
		return nil, false
	}
	r := &reader{ok: true}
	plan := &Plan{
		Summary:            r.text(given.Summary, 1_500),
		Audiences:          readAudiences(r, given.Audiences),
		Positioning:        r.text(given.Positioning, 1_000),
		Goals:              readGoals(r, given.Goals),
		Pillars:            readPillars(r, given.Pillars),
		Campaigns:          readCampaigns(r, given.Campaigns),
		Cadence:            readCadence(r, given.Cadence),
		Statements:         readStatements(r, given.Statements),
		MissingInformation: r.texts(given.MissingInformation, 300, missingInfoLimits),
		Cautions:           r.texts(given.Cautions, 300, cautionLimits),
	}
	if !r.ok {
		return nil, false
	}
	ApplyFactBasisRule(plan, sentTopics)
	return plan, true
}

// reader reads the parts of one plan; anything unusable sets ok to false.
type reader struct{ ok bool }

// text is one plain line, cut to maxLength, never empty.
func (r *reader) text(value *string, maxLength int) string {
	if value == nil {
		r.ok = false
		return ""
	}
	cut := CutPlanText(plaintext.SingleLine(*value), maxLength)
	if cut == "" {
		r.ok = false
	}
	return cut
}

// texts is a list of short texts: blank ones left out, the first max kept, at least min.
func (r *reader) texts(values *[]*string, maxLength int, limits listLimits) []string {
	if values == nil {
		r.ok = false
		return nil
	}
	kept := []string{}
	for _, value := range *values {
		if value == nil {
			r.ok = false
			return nil
		}
		if cut := CutPlanText(plaintext.SingleLine(*value), maxLength); cut != "" {
			kept = append(kept, cut)
		}
	}
	return keepWithin(r, kept, limits)
}

// keepWithin keeps the first max entries, and needs at least min.
func keepWithin[T any](r *reader, all []T, limits listLimits) []T {
	if len(all) < limits.min {
		r.ok = false
	}
	if len(all) > limits.max {
		return all[:limits.max]
	}
	return all
}

func readAudiences(r *reader, given *[]rawAudience) []Audience {
	all := []Audience{}
	for _, a := range listOf(r, given) {
		all = append(all, Audience{Name: r.text(a.Name, 120), Needs: r.text(a.Needs, 600), WhereToReach: r.text(a.WhereToReach, 400)})
	}
	return keepWithin(r, all, audienceLimits)
}

func readGoals(r *reader, given *[]rawGoal) []Goal {
	all := []Goal{}
	for _, g := range listOf(r, given) {
		all = append(all, Goal{Goal: r.text(g.Goal, 300), HowToMeasure: r.text(g.HowToMeasure, 400)})
	}
	return keepWithin(r, all, goalLimits)
}

func readPillars(r *reader, given *[]rawPillar) []Pillar {
	all := []Pillar{}
	for _, p := range listOf(r, given) {
		all = append(all, Pillar{Name: r.text(p.Name, 120), Description: r.text(p.Description, 600), ExampleTopics: r.texts(p.ExampleTopics, 200, exampleTopicLimits)})
	}
	return keepWithin(r, all, pillarLimits)
}

func readCampaigns(r *reader, given *[]rawCampaign) []Campaign {
	all := []Campaign{}
	for _, c := range listOf(r, given) {
		all = append(all, Campaign{
			Name: r.text(c.Name, 120), Objective: r.text(c.Objective, 400), Pillar: r.text(c.Pillar, 120),
			Platforms: r.platforms(c.Platforms), Timing: r.text(c.Timing, 200), CallToAction: r.text(c.CallToAction, 200),
		})
	}
	return keepWithin(r, all, campaignLimits)
}

// platforms of one campaign: each known, each once, at least one.
func (r *reader) platforms(given *[]*string) []string {
	seen := map[string]bool{}
	kept := []string{}
	for _, platform := range listOf(r, given) {
		if platform == nil || PlatformLabels[*platform] == "" {
			r.ok = false
			return nil
		}
		if !seen[*platform] {
			seen[*platform] = true
			kept = append(kept, *platform)
		}
	}
	return keepWithin(r, kept, listLimits{1, len(Platforms)})
}

// readCadence keeps one entry per platform (the first given), none for a
// platform with no posts planned (0 is no cadence), at most 4.
func readCadence(r *reader, given *[]rawCadence) []Cadence {
	seen := map[string]bool{}
	kept := []Cadence{}
	for _, entry := range listOf(r, given) {
		if entry.Platform == nil || PlatformLabels[*entry.Platform] == "" || entry.PostsPerWeek == nil || *entry.PostsPerWeek < 0 || *entry.PostsPerWeek > postsPerWeekMax {
			r.ok = false
			return nil
		}
		// One decimal, as the page shows it, rounding half up as JavaScript did.
		perWeek := math.Floor(*entry.PostsPerWeek*10+0.5) / 10
		formats := r.texts(entry.Formats, 80, formatLimits)
		if perWeek > 0 && !seen[*entry.Platform] {
			seen[*entry.Platform] = true
			kept = append(kept, Cadence{Platform: *entry.Platform, PostsPerWeek: perWeek, Formats: formats})
		}
	}
	return keepWithin(r, kept, cadenceLimits)
}

// readStatements keeps each statement's fact_topics as named (each once):
// the fact rule needs every name before it keeps only the ones sent.
func readStatements(r *reader, given *[]rawStatement) []Statement {
	all := []Statement{}
	for _, s := range listOf(r, given) {
		if s.Basis == nil || (*s.Basis != "fact" && *s.Basis != "assumption" && *s.Basis != "suggestion") {
			r.ok = false
			return nil
		}
		statement := Statement{Text: r.text(s.Text, 500), Basis: *s.Basis, FactTopics: []string{}}
		seen := map[string]bool{}
		for _, topic := range listOf(r, s.FactTopics) {
			if topic == nil {
				r.ok = false
				return nil
			}
			if !seen[*topic] {
				seen[*topic] = true
				statement.FactTopics = append(statement.FactTopics, *topic)
			}
		}
		all = append(all, statement)
	}
	return keepWithin(r, all, statementLimits)
}

// listOf is a list that must be there (an empty one is fine here).
func listOf[T any](r *reader, given *[]T) []T {
	if given == nil {
		r.ok = false
		return nil
	}
	return *given
}
