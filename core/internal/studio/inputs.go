package studio

import (
	"context"
	"strings"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/knowledge"
	"ansa/core/internal/tenant"
)

// What a draft is written from (the old services/content-generation-inputs.ts),
// gathered for one company: the platform's rules (contentrules, so what the
// AI is told is what the approval checks), its confirmed facts (never a
// proposal), the words to avoid among them, the current plan's positioning
// and audiences and the pillar and campaign picked from it, and approved
// MARKETING articles matching the topic. Nothing of support, tickets or
// customers, ever; no id, account or person.

// Where each platform's feed cuts a post with its "see more" (the AI is
// told to put what matters first); X shows a post whole.
var feedCuts = map[string]map[string]any{
	"linkedin": {"characters": 210, "more_label": "...see more"},
	"facebook": {"characters": 480, "more_label": "See more"},
	"youtube":  {"characters": 160, "more_label": "...more"},
}

// DraftRequest is what a draft is written for.
type DraftRequest struct {
	Platform, Format string
	Placement        Placement
}

// inputs are the brain's request and what it was made from.
type inputs struct {
	request       map[string]any
	knowledgeUsed []string
	planVersion   *int
}

// gatherInputs builds the brain's request for one company's draft.
func gatherInputs(ctx context.Context, pool *database.Pool, company tenant.CompanyID, facts map[string]string, r DraftRequest) (inputs, error) {
	plan, err := readCurrentPlan(ctx, pool, company)
	if err != nil {
		return inputs{}, err
	}
	query := combineSearchTexts(r.Placement.Topic, r.Placement.Pillar, r.Placement.Campaign)
	hits, err := knowledge.Search(ctx, pool, company, query, "marketing", drafts.KnowledgeHits)
	if err != nil {
		return inputs{}, err
	}
	kept, slice := knowledge.Slice(hits, drafts.KnowledgeCharacters)
	used := []string{}
	for _, hit := range kept {
		if !drafts.In(used, hit.ArticleID) {
			used = append(used, hit.ArticleID)
		}
	}
	request := map[string]any{
		"platform": platformForBrain(r.Platform), "format": r.Format, "format_name": contentrules.FormatLabels[r.Format],
		"topic": r.Placement.Topic, "pillar": pillarFor(plan, r.Placement.Pillar), "campaign": campaignFor(plan, r.Placement.Campaign),
		"plan": planForBrain(plan), "facts": factsForBrain(facts), "words_to_avoid": orNone(contentrules.ReadWordsToAvoid(facts["words_to_avoid"])),
		"knowledge_slice": slice, "topic_keys": topicKeys(),
	}
	var planVersion *int
	if plan != nil {
		planVersion = &plan.Version
	}
	return inputs{request: request, knowledgeUsed: used, planVersion: planVersion}, nil
}

// platformForBrain is the platform's rules as contentrules holds them.
func platformForBrain(platform string) map[string]any {
	rules := contentrules.PlatformRules[platform]
	var feedCut any
	if cut, has := feedCuts[platform]; has {
		feedCut = cut
	}
	return map[string]any{
		"key": platform, "name": contentrules.PlatformLabels[platform], "accepted_formats": contentrules.DescribeAcceptedFormats(platform),
		"title_max": rules.TitleMax, "text_label": rules.TextLabel, "text_max": rules.TextMax, "text_counting": rules.TextCounting,
		"refuses_angle_brackets": rules.RefusesAngleBrackets, "hashtags_max": rules.HashtagsMax,
		"hashtags_recommended": rules.HashtagsRecommended, "feed_cut": feedCut,
	}
}

// pillarFor is the picked pillar with what the plan says about it; a name
// the current plan doesn't have goes as the name alone (nil: none picked).
func pillarFor(plan *Plan, name string) any {
	if name == "" {
		return nil
	}
	if plan != nil {
		for _, pillar := range plan.Pillars {
			if sameName(pillar.Name, name) {
				return map[string]any{"name": pillar.Name, "description": pillar.Description, "example_topics": orNone(pillar.ExampleTopics)}
			}
		}
	}
	return map[string]any{"name": name, "description": nil, "example_topics": []string{}}
}

// campaignFor is the picked campaign with what the plan says about it.
func campaignFor(plan *Plan, name string) any {
	if name == "" {
		return nil
	}
	if plan != nil {
		for _, campaign := range plan.Campaigns {
			if sameName(campaign.Name, name) {
				return map[string]any{"name": campaign.Name, "objective": campaign.Objective, "timing": campaign.Timing, "call_to_action": campaign.CallToAction}
			}
		}
	}
	return map[string]any{"name": name, "objective": nil, "timing": nil, "call_to_action": nil}
}

// planForBrain is the plan's positioning and audiences (nil: no plan).
func planForBrain(plan *Plan) any {
	if plan == nil {
		return nil
	}
	audiences := []map[string]string{}
	for _, audience := range plan.Audiences {
		audiences = append(audiences, map[string]string{"name": audience.Name, "needs": audience.Needs, "where_to_reach": audience.WhereToReach})
	}
	return map[string]any{"positioning": plan.Positioning, "audiences": audiences}
}

// factsForBrain are the confirmed facts in the topics' order, each with its label.
func factsForBrain(facts map[string]string) []map[string]string {
	list := []map[string]string{}
	for _, fact := range drafts.OrderedFacts(facts) {
		list = append(list, map[string]string{"topic": fact.Topic, "label": drafts.TopicLabel(fact.Topic), "value": fact.Value})
	}
	return list
}

func topicKeys() []string {
	keys := []string{}
	for _, topic := range drafts.Topics {
		keys = append(keys, topic.Key)
	}
	return keys
}

// combineSearchTexts searches several texts as one (the old
// combineSearchTexts): their words taken in turns (the first word of each,
// then the second of each...), so one long text can't take all 20 words
// of a search and leave the others out.
func combineSearchTexts(texts ...string) string {
	var wordsOfEach [][]string
	for _, text := range texts {
		wordsOfEach = append(wordsOfEach, searchWords(text))
	}
	var inTurns []string
	for position := 0; position < 20; position++ {
		for _, words := range wordsOfEach {
			if position < len(words) && !drafts.In(inTurns, words[position]) {
				inTurns = append(inTurns, words[position])
			}
		}
	}
	return strings.Join(inTurns[:min(len(inTurns), 20)], " ")
}

// searchWords are the words a search keeps of a text, in order, each once:
// the terms of knowledge.BuildTsQuery without its prefix marks.
func searchWords(text string) []string {
	query := knowledge.BuildTsQuery(text)
	if query == "" {
		return nil
	}
	var words []string
	for _, term := range strings.Split(query, " | ") {
		words = append(words, strings.TrimSuffix(term, ":*"))
	}
	return words
}
