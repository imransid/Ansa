package strategy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/profile"
	"ansa/core/internal/tenant"
)

// The newest performance review as the planner reads it (the old
// lib/performance-review/past-performance.ts): only what the review kept
// (every number in it was checked against what the platforms gave), each
// cited number with the post or group it names. Never the review's whole
// input: only the posts and groups its findings cite. The brain words it,
// hides card numbers and escapes it. A review this code can't read (saved
// by another version) is left out.

// PastPerformance is the review as the brain gets it.
type PastPerformance struct {
	ReviewedOn       string        `json:"reviewed_on"`
	PostsFrom        string        `json:"posts_from"`
	PostsTo          string        `json:"posts_to"`
	PostsWithNumbers int           `json:"posts_with_numbers"`
	Simulated        bool          `json:"simulated"`
	Findings         []PastFinding `json:"findings"`
	Recommendations  []string      `json:"recommendations"`
	Limits           []string      `json:"limits"`
}

// PastFinding is one kept finding and the numbers it cites.
type PastFinding struct {
	Text    string       `json:"text"`
	Numbers []PastNumber `json:"numbers"`
}

// PastNumber is one cited number: a post's or a group's (GroupLabel: the
// group as the review named it, when the input has no such group).
type PastNumber struct {
	Metric     string       `json:"metric"`
	Value      float64      `json:"value"`
	Post       *ReviewPost  `json:"post"`
	Group      *ReviewGroup `json:"group"`
	GroupLabel string       `json:"group_label"`
}

// ReviewPost is one post of the review's input, as the planner names it.
type ReviewPost struct {
	Label    string `json:"label"`
	Platform string `json:"platform"`
	Format   string `json:"format"`
	Topic    string `json:"topic"`
	Weekday  string `json:"weekday"`
	Hour     string `json:"hour"`
}

// ReviewGroup is one group of the review's input, with how many posts it holds.
type ReviewGroup struct {
	Label string `json:"label"`
	Kind  string `json:"kind"`
	Name  string `json:"name"`
	Posts int    `json:"posts"`
}

type storedInput struct {
	Period struct {
		Start string `json:"start"`
		End   string `json:"end"`
	} `json:"period"`
	PostCount int          `json:"postCount"`
	Simulated bool         `json:"simulated"`
	Posts     []ReviewPost `json:"posts"`
	Groups    []struct {
		Label   string             `json:"label"`
		Kind    string             `json:"kind"`
		Name    string             `json:"name"`
		Numbers map[string]float64 `json:"numbers"`
	} `json:"groups"`
}

type storedReview struct {
	Findings []struct {
		Text     string `json:"text"`
		Evidence []struct {
			PostLabel string  `json:"post_label"`
			Group     string  `json:"group"`
			Metric    string  `json:"metric"`
			Value     float64 `json:"value"`
		} `json:"evidence"`
	} `json:"findings"`
	Recommendations []struct {
		Text            string `json:"text"`
		BasedOnFindings []int  `json:"based_on_findings"`
	} `json:"recommendations"`
	Limits []string `json:"limits_of_this_data"`
}

// NewestReview is one company's newest performance review for the planner,
// and its id; nil when there is none it can read.
func NewestReview(ctx context.Context, q profile.Querier, company tenant.CompanyID) (*PastPerformance, string, error) {
	const statement = `
		SELECT id, created_at, input_summary::text, review::text FROM performance_reviews
		WHERE company_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`
	rows, err := q.Query(ctx, statement, company.String())
	if err != nil {
		return nil, "", err
	}
	type reviewRow struct {
		ID, Input, Review string
		CreatedAt         time.Time
	}
	row, err := pgx.CollectExactlyOneRow(rows, func(r pgx.CollectableRow) (reviewRow, error) {
		var v reviewRow
		return v, r.Scan(&v.ID, &v.CreatedAt, &v.Input, &v.Review)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	past, ok := readStoredReview([]byte(row.Input), []byte(row.Review), row.CreatedAt)
	if !ok {
		return nil, "", nil
	}
	return past, row.ID, nil
}

// readStoredReview reads a stored review with what it was made from; false
// when either is of a shape this code can't read.
func readStoredReview(inputJSON, reviewJSON []byte, madeAt time.Time) (*PastPerformance, bool) {
	var input storedInput
	var review storedReview
	strict := json.NewDecoder(bytes.NewReader(reviewJSON))
	strict.DisallowUnknownFields()
	if json.Unmarshal(inputJSON, &input) != nil || strict.Decode(&review) != nil || !readableInput(input) {
		return nil, false
	}
	past := &PastPerformance{
		ReviewedOn: madeAt.UTC().Format("2006-01-02"), PostsFrom: input.Period.Start[:10], PostsTo: input.Period.End[:10],
		PostsWithNumbers: input.PostCount, Simulated: input.Simulated, Findings: []PastFinding{}, Recommendations: []string{}, Limits: review.Limits,
	}
	for _, finding := range review.Findings {
		kept := PastFinding{Text: finding.Text, Numbers: []PastNumber{}}
		for _, evidence := range finding.Evidence {
			kept.Numbers = append(kept.Numbers, citedNumber(input, evidence.PostLabel, evidence.Group, evidence.Metric, evidence.Value))
		}
		past.Findings = append(past.Findings, kept)
	}
	for _, recommendation := range review.Recommendations {
		past.Recommendations = append(past.Recommendations, recommendation.Text)
	}
	if past.Limits == nil {
		past.Limits = []string{}
	}
	return past, true
}

// readableInput: the period's times are real, and every post names a
// platform and format ansa knows, every group a kind.
func readableInput(input storedInput) bool {
	for _, at := range []string{input.Period.Start, input.Period.End} {
		if _, err := time.Parse(time.RFC3339, at); err != nil {
			return false
		}
	}
	for _, post := range input.Posts {
		if PlatformLabels[post.Platform] == "" || (post.Format != "post" && post.Format != "image_post" && post.Format != "video") {
			return false
		}
	}
	for _, group := range input.Groups {
		if group.Kind != "platform" && group.Kind != "pillar" && group.Kind != "no_pillar" {
			return false
		}
	}
	return true
}

// citedNumber is one cited number with the post or group it names.
func citedNumber(input storedInput, postLabel, groupLabel, metric string, value float64) PastNumber {
	number := PastNumber{Metric: metric, Value: value, GroupLabel: groupLabel}
	for index := range input.Posts {
		if input.Posts[index].Label == postLabel {
			post := input.Posts[index]
			number.Post = &post
			return number
		}
	}
	for _, group := range input.Groups {
		if group.Label == groupLabel {
			number.Group = &ReviewGroup{Label: group.Label, Kind: group.Kind, Name: group.Name, Posts: int(group.Numbers["posts"])}
			break
		}
	}
	return number
}
