package analytics

import (
	"sort"
	"strings"
	"unicode/utf16"

	"ansa/core/internal/plaintext"
)

// Checking the AI's performance review (the old
// lib/performance-review/review-answer.ts). THIS CODE checks every number:
// a finding is kept only when each number it cites is exactly one the
// request held (that post's or group's, under that name), and its text
// writes no other; a wrong or invented number drops the whole finding.
// Recommendations keep only the findings they follow from, and none
// without. No finding left = no review: nothing is saved.

// The most entries of each list a saved review keeps (the AI is told them),
// and the longest texts.
const (
	maxFindings        = 8
	maxEvidence        = 6
	maxRecommendations = 6
	maxLimits          = 5
	reviewTextMax      = 500
	reviewLimitTextMax = 300
	planTextCutMarker  = "..."
)

// Evidence is one cited number: a post's (PostLabel) or a group's (Group), the other "".
type Evidence struct {
	PostLabel string  `json:"post_label"`
	Group     string  `json:"group"`
	Metric    string  `json:"metric"`
	Value     float64 `json:"value"`
}

// Finding is what the numbers show, with the numbers it rests on.
type Finding struct {
	Text     string     `json:"text"`
	Evidence []Evidence `json:"evidence"`
}

// Recommendation: BasedOn are the kept findings' numbers, 1 for the first.
type Recommendation struct {
	Text    string `json:"text"`
	BasedOn []int  `json:"based_on_findings"`
}

// Review is a review as the AI writes it and as it is stored (the old
// keys), once checked.
type Review struct {
	Findings        []Finding        `json:"findings"`
	Recommendations []Recommendation `json:"recommendations"`
	Limits          []string         `json:"limits_of_this_data"`
}

// checkReview keeps the findings whose numbers all match the request, the
// recommendations that follow from them (renumbered) and the limits
// writing no number the request doesn't hold; nil when no finding is left.
func checkReview(answer Review, input ReviewInput) *Review {
	var findings []Finding
	keptNumberOf := map[int]int{}
	for index, finding := range answer.Findings {
		if checked := checkFinding(finding, input); checked != nil && len(findings) < maxFindings {
			findings = append(findings, *checked)
			keptNumberOf[index+1] = len(findings)
		}
	}
	if len(findings) == 0 {
		return nil
	}
	review := &Review{Findings: findings, Recommendations: []Recommendation{}, Limits: []string{}}
	for _, recommendation := range answer.Recommendations {
		if kept := checkRecommendation(recommendation, findings, keptNumberOf, input); kept != nil && len(review.Recommendations) < maxRecommendations {
			review.Recommendations = append(review.Recommendations, *kept)
		}
	}
	everyName := []string{}
	for _, post := range input.Posts {
		everyName = append(everyName, post.Topic)
	}
	for _, group := range input.Groups {
		everyName = append(everyName, group.Name)
	}
	inputNumbers := numbersInInput(input)
	for _, limit := range answer.Limits {
		text := cleanText(limit, reviewLimitTextMax)
		if text != "" && writesOnlyAllowedNumbers(text, inputNumbers, everyName) && len(review.Limits) < maxLimits {
			review.Limits = append(review.Limits, text)
		}
	}
	return review
}

// checkRecommendation keeps a recommendation that follows from at least one
// kept finding and writes only their numbers (or a time), renumbered.
func checkRecommendation(recommendation Recommendation, findings []Finding, keptNumberOf map[int]int, input ReviewInput) *Recommendation {
	seen := map[int]bool{}
	basedOn := []int{}
	for _, number := range recommendation.BasedOn {
		if kept, ok := keptNumberOf[number]; ok && !seen[kept] {
			seen[kept] = true
			basedOn = append(basedOn, kept)
		}
	}
	sort.Ints(basedOn)
	text := cleanText(recommendation.Text, reviewTextMax)
	var cited []Finding
	var allowed []float64
	for _, number := range basedOn {
		cited = append(cited, findings[number-1])
		for _, evidence := range findings[number-1].Evidence {
			allowed = append(allowed, evidence.Value)
		}
	}
	if len(basedOn) == 0 || text == "" || !writesOnlyAllowedNumbers(text, allowed, namesCitedBy(cited, input)) {
		return nil
	}
	return &Recommendation{Text: text, BasedOn: basedOn}
}

// checkFinding is the finding as kept, or nil when any number it cites
// isn't in the request as cited, it cites none, or its text writes a
// number it doesn't cite.
func checkFinding(finding Finding, input ReviewInput) *Finding {
	text := cleanText(finding.Text, reviewTextMax)
	var evidence []Evidence
	for _, entry := range finding.Evidence {
		checked := checkEvidence(entry, input)
		if checked == nil {
			return nil
		}
		if !hasCitation(evidence, *checked) {
			evidence = append(evidence, *checked)
		}
	}
	// Only the first ones are kept, so the text may write only theirs.
	if len(evidence) > maxEvidence {
		evidence = evidence[:maxEvidence]
	}
	if text == "" || len(evidence) == 0 {
		return nil
	}
	kept := Finding{Text: text, Evidence: evidence}
	var values []float64
	for _, entry := range evidence {
		values = append(values, entry.Value)
	}
	if !writesOnlyAllowedNumbers(text, values, namesCitedBy([]Finding{kept}, input)) {
		return nil
	}
	return &kept
}

func hasCitation(evidence []Evidence, entry Evidence) bool {
	for _, seen := range evidence {
		if seen.PostLabel == entry.PostLabel && seen.Group == entry.Group && seen.Metric == entry.Metric {
			return true
		}
	}
	return false
}

// checkEvidence is one cited number exactly as the request held it, or nil.
func checkEvidence(entry Evidence, input ReviewInput) *Evidence {
	postLabel, group, metric := trimLikeJavaScript(entry.PostLabel), trimLikeJavaScript(entry.Group), trimLikeJavaScript(entry.Metric)
	if (postLabel == "") == (group == "") {
		return nil
	}
	var numbers Numbers
	if postLabel != "" {
		if post := findPost(input, postLabel); post != nil {
			numbers = post.Numbers
		}
	} else if found := findGroup(input, group); found != nil {
		numbers = found.Numbers
	}
	given, has := numbers[metric]
	if !has || given != entry.Value {
		return nil
	}
	return &Evidence{PostLabel: postLabel, Group: group, Metric: metric, Value: given}
}

// namesCitedBy are the topics of the posts and the names of the groups
// these findings cite: a number quoted from one ("Top 5 breads") is no result.
func namesCitedBy(findings []Finding, input ReviewInput) []string {
	var names []string
	for _, finding := range findings {
		for _, entry := range finding.Evidence {
			name := ""
			if entry.PostLabel != "" {
				if post := findPost(input, entry.PostLabel); post != nil {
					name = post.Topic
				}
			} else if group := findGroup(input, entry.Group); group != nil {
				name = group.Name
			}
			names = append(names, name)
		}
	}
	return names
}

func findPost(input ReviewInput, label string) *ReviewPost {
	for index := range input.Posts {
		if input.Posts[index].Label == label {
			return &input.Posts[index]
		}
	}
	return nil
}

func findGroup(input ReviewInput, label string) *ReviewGroup {
	for index := range input.Groups {
		if input.Groups[index].Label == label {
			return &input.Groups[index]
		}
	}
	return nil
}

// cleanText is one plain line, cut at a word with "..." when too long (the
// old cutPlanText(toPlainSingleLine(text))). Lengths count UTF-16 units, as
// JavaScript's do; a cut never splits an emoji. WHY not before its middle:
// a text with few spaces (Chinese, Japanese) would otherwise say almost nothing.
func cleanText(text string, maxLength int) string {
	units := utf16.Encode([]rune(plaintext.SingleLine(text)))
	if len(units) <= maxLength {
		return string(utf16.Decode(units))
	}
	kept := units[:maxLength-len(planTextCutMarker)]
	if last := kept[len(kept)-1]; last >= 0xd800 && last <= 0xdbff {
		kept = kept[:len(kept)-1]
	}
	keptText := strings.TrimRightFunc(string(utf16.Decode(kept)), isJavaScriptSpace)
	kept = utf16.Encode([]rune(keptText))
	if lastSpace := lastSpaceIn(kept); lastSpace >= 0 && 2*lastSpace >= len(kept) {
		kept = kept[:lastSpace]
	}
	return strings.TrimRightFunc(string(utf16.Decode(kept)), isJavaScriptSpace) + planTextCutMarker
}

func lastSpaceIn(units []uint16) int {
	for index := len(units) - 1; index >= 0; index-- {
		if units[index] == ' ' {
			return index
		}
	}
	return -1
}

// trimLikeJavaScript trims what JavaScript's trim() does.
func trimLikeJavaScript(text string) string {
	return strings.TrimFunc(text, isJavaScriptSpace)
}

// isJavaScriptSpace: JavaScript's white space and line terminators.
func isJavaScriptSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}
