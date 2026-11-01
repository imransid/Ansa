package analytics

import (
	"bytes"
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"time"
)

// A saved performance review read back for the Analytics page (the old
// lib/performance-review/stored-review.ts): its input_summary and review
// in the shapes they were saved in, and each cited number described in
// words. A row this code can't read (saved by another version) shows as such.

// ShownReview is the newest review as the page shows it. Readable false:
// saved in a shape this code can't read (then no findings).
type ShownReview struct {
	MadeAt          time.Time             `json:"madeAt"`
	MadeByName      *string               `json:"madeByName"`
	PeriodStart     time.Time             `json:"periodStart"`
	PeriodEnd       time.Time             `json:"periodEnd"`
	Readable        bool                  `json:"readable"`
	PostCount       int                   `json:"postCount"`
	Simulated       bool                  `json:"simulated"`
	Findings        []ShownFinding        `json:"findings"`
	Recommendations []ShownRecommendation `json:"recommendations"`
	Limits          []string              `json:"limits"`
}

// ShownFinding is a finding with each number it cites in words.
type ShownFinding struct {
	Text     string              `json:"text"`
	Evidence []DescribedEvidence `json:"evidence"`
}

// ShownRecommendation: BasedOn are the findings' numbers, 1 for the first.
type ShownRecommendation struct {
	Text    string `json:"text"`
	BasedOn []int  `json:"basedOn"`
}

// DescribedEvidence is one cited number in words: where it comes from, with
// the label the finding's text uses ("P3: “Our sourdough”, LinkedIn text
// post, Tuesday 09:00"), what it counts ("Reactions per post") and its value.
type DescribedEvidence struct {
	Source    string `json:"source"`
	Metric    string `json:"metric"`
	Value     string `json:"value"`
	Simulated bool   `json:"simulated"`
}

// toShownReview describes a stored review; unreadable rows say so.
func toShownReview(shown ShownReview, inputJSON, reviewJSON []byte) *ShownReview {
	shown.Findings, shown.Recommendations, shown.Limits = []ShownFinding{}, []ShownRecommendation{}, []string{}
	input, review := readStoredReview(inputJSON, reviewJSON)
	if input == nil || review == nil {
		return &shown
	}
	shown.Readable, shown.PostCount, shown.Simulated = true, input.PostCount, input.Simulated
	for _, finding := range review.Findings {
		described := ShownFinding{Text: finding.Text, Evidence: []DescribedEvidence{}}
		for _, evidence := range finding.Evidence {
			described.Evidence = append(described.Evidence, describeEvidence(evidence, *input))
		}
		shown.Findings = append(shown.Findings, described)
	}
	for _, recommendation := range review.Recommendations {
		// The same fields, under the page's JSON names (basedOn).
		shown.Recommendations = append(shown.Recommendations, ShownRecommendation(recommendation))
	}
	shown.Limits = append(shown.Limits, review.Limits...)
	return &shown
}

// readStoredReview reads both columns, or nil when either can't be read:
// the input leniently (an unknown key is ignored, as the old schema did),
// the review strictly (an unknown key makes it unreadable).
func readStoredReview(inputJSON, reviewJSON []byte) (*ReviewInput, *Review) {
	var input ReviewInput
	if json.Unmarshal(inputJSON, &input) != nil || !isReadableInput(input) {
		return nil, nil
	}
	decoder := json.NewDecoder(bytes.NewReader(reviewJSON))
	decoder.DisallowUnknownFields()
	var review Review
	if decoder.Decode(&review) != nil || review.Findings == nil || review.Recommendations == nil || review.Limits == nil {
		return nil, nil
	}
	return &input, &review
}

func isReadableInput(input ReviewInput) bool {
	for _, moment := range []string{input.Period.Start, input.Period.End} {
		if _, err := time.Parse(time.RFC3339Nano, moment); err != nil || !strings.HasSuffix(moment, "Z") {
			return false
		}
	}
	for _, post := range input.Posts {
		if PlatformLabels[post.Platform] == "" || FormatLabels[post.Format] == "" {
			return false
		}
	}
	for _, group := range input.Groups {
		if group.Kind != "platform" && group.Kind != "pillar" && group.Kind != "no_pillar" {
			return false
		}
	}
	return input.Posts != nil && input.Groups != nil
}

func describeEvidence(evidence Evidence, input ReviewInput) DescribedEvidence {
	if post := findPost(input, evidence.PostLabel); post != nil {
		metric := evidence.Metric
		if MetricLabels[metric] != "" {
			metric = MetricLabel(post.Platform, metric)
		}
		return DescribedEvidence{Source: describePost(*post), Metric: metric, Value: formatNumber(evidence.Value), Simulated: post.Simulated}
	}
	source := evidence.Group
	if group := findGroup(input, evidence.Group); group != nil {
		source = describeGroup(*group)
	}
	return DescribedEvidence{Source: source, Metric: describeGroupMetric(evidence.Metric), Value: formatNumber(evidence.Value), Simulated: input.Simulated}
}

func describePost(post ReviewPost) string {
	return post.Label + ": “" + post.Topic + "”, " + PlatformLabels[post.Platform] + " " + strings.ToLower(FormatLabels[post.Format]) + ", " + post.Weekday + " " + post.Hour
}

func describeGroup(group ReviewGroup) string {
	posts := group.Numbers["posts"]
	count := strconv.FormatFloat(posts, 'f', -1, 64) + " posts"
	if posts == 1 {
		count = "1 post"
	}
	switch group.Kind {
	case "platform":
		return group.Label + ": all " + group.Name + " posts (" + count + ")"
	case "pillar":
		return group.Label + ": pillar “" + group.Name + "” (" + count + ")"
	}
	return group.Label + ": posts without a pillar (" + count + ")"
}

// describeGroupMetric: "views_total" -> "Views (all posts)", "views_per_post"
// -> "Views per post", "views_posts" -> "Posts with views", "posts" -> "Posts".
func describeGroupMetric(metric string) string {
	if metric == "posts" {
		return "Posts"
	}
	for _, column := range MetricColumns {
		label := MetricLabels[column]
		switch metric {
		case column + "_total":
			return label + " (all posts)"
		case column + "_per_post":
			return label + " per post"
		case column + "_posts":
			return "Posts with " + strings.ToLower(label)
		}
	}
	return metric
}

// formatNumber writes a number as the pages do (en-US, at most one
// decimal): 1,234 or 6.5.
func formatNumber(value float64) string {
	tenths := math.Round(math.Abs(value) * 10)
	whole := math.Floor(tenths / 10)
	text := groupThousands(strconv.FormatFloat(whole, 'f', 0, 64))
	if fraction := int(tenths - whole*10); fraction != 0 {
		text += "." + strconv.Itoa(fraction)
	}
	if value < 0 && tenths != 0 {
		text = "-" + text
	}
	return text
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
