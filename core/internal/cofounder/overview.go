package cofounder

import (
	"context"
	"strconv"
	"strings"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/profile"
	"ansa/core/internal/strategy"
	"ansa/core/internal/tenant"
)

// Overview is the Co-Founder Overview page (the old CoFounderOverview).
type Overview struct {
	Completion        profile.Completion   `json:"completion"`
	MissingKeyTopics  []profile.TopicLabel `json:"missingKeyTopics"`
	InterviewStarted  bool                 `json:"interviewStarted"`
	InterviewFinished bool                 `json:"interviewFinished"`
	// Owners only (members can't do any of it), most useful first.
	NextSteps []NextStep `json:"nextSteps"`
	Strategy  Strategy   `json:"strategy"`
	// Everyone reads it: each step names the page where it is done.
	Checklist []Step `json:"checklist"`
}

// NextStep is one thing an owner should do next.
type NextStep struct {
	Label       string `json:"label"`
	Href        string `json:"href"`
	Description string `json:"description"`
}

// Strategy is the current plan (nil: none yet) and what a plan still needs.
type Strategy struct {
	CurrentPlan    *PlanVersion           `json:"currentPlan"`
	MissingForPlan []strategy.MissingFact `json:"missingForPlan"`
}

// PlanVersion names one plan version.
type PlanVersion struct {
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
}

// How many missing topics a next step names before "and N more".
const missingTopicsNamed = 3

// Read gathers one company's Overview; isOwner decides the next steps.
func Read(ctx context.Context, pool *database.Pool, company tenant.CompanyID, isOwner bool) (Overview, error) {
	facts, err := profile.ReadFacts(ctx, pool, company)
	if err != nil {
		return Overview{}, err
	}
	started, finished, err := profile.InterviewState(ctx, pool, company)
	if err != nil {
		return Overview{}, err
	}
	versions, err := strategy.ListVersions(ctx, pool, company, 1)
	if err != nil {
		return Overview{}, err
	}
	state, err := readProgress(ctx, pool, company)
	if err != nil {
		return Overview{}, err
	}
	missing := facts.MissingKeyTopics()
	o := Overview{Completion: facts.Completion(), MissingKeyTopics: labels(missing), InterviewStarted: started, NextSteps: []NextStep{},
		Strategy: Strategy{MissingForPlan: strategy.MissingForPlan(facts.ConfirmedTopics())}}
	// As on the Interview page: a key proposal dismissed after the closing
	// message makes its topic missing again, and the interview goes on.
	o.InterviewFinished = finished && len(missing) == 0
	state.InterviewStarted, state.InterviewFinished, state.Completion = started, o.InterviewFinished, o.Completion
	if len(versions) > 0 {
		o.Strategy.CurrentPlan = &PlanVersion{Version: versions[0].Version, CreatedAt: versions[0].CreatedAt}
		state.PlanVersion = versions[0].Version
	}
	o.Checklist = Checklist(state)
	if isOwner {
		o.NextSteps = nextSteps(o)
	}
	return o, nil
}

// readProgress: whether each later step happened, each a yes/no Postgres
// answers from the first row it finds, the company first in every WHERE,
// and the accounts as of now (connected, but its access ended and nothing
// can renew it, counts as needing a reconnect).
func readProgress(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (State, error) {
	var s State
	const statement = `
		SELECT
			EXISTS (SELECT 1 FROM content_drafts WHERE company_id = $1 AND NOT (title = '' AND body = '' AND call_to_action = ''
				AND image_prompt = '' AND video_script = '' AND cardinality(hashtags) = 0 AND media_asset_id IS NULL)),
			EXISTS (SELECT 1 FROM publish_jobs WHERE company_id = $1 AND status <> 'canceled'),
			EXISTS (SELECT 1 FROM post_metrics WHERE company_id = $1),
			(SELECT count(*) FROM social_connections WHERE company_id = $1 AND status = 'connected' AND NOT ` + ranOut + `),
			(SELECT count(*) FROM social_connections WHERE company_id = $1 AND status = 'connected' AND NOT ` + ranOut + ` AND is_stand_in),
			(SELECT count(*) FROM social_connections WHERE company_id = $1 AND (status = 'needs_reauth' OR (status = 'connected' AND ` + ranOut + `)))`
	err := pool.QueryRow(ctx, statement, company.String()).Scan(&s.HasWrittenDraft, &s.HasScheduledPost, &s.HasPostNumbers,
		&s.ConnectedAccounts, &s.StandInAccounts, &s.AccountsNeedingReconnect)
	return s, err
}

// A connected account whose access ended with nothing to renew it (a
// refresh token, still within its own end).
const ranOut = `(access_expires_at IS NOT NULL AND access_expires_at <= now()
	AND NOT (refresh_token_encrypted IS NOT NULL AND (refresh_expires_at IS NULL OR refresh_expires_at > now())))`

// nextSteps: proposals first (confirming is quick, and until then the AI's
// reading is not the owner's word), then the interview while a key topic
// has nothing at all, then, with everything confirmed, the profile.
func nextSteps(o Overview) []NextStep {
	steps := []NextStep{}
	if waiting := o.Completion.ProposalsWaiting; waiting > 0 {
		label := "Confirm 1 proposed fact"
		if waiting > 1 {
			label = "Confirm " + strconv.Itoa(waiting) + " proposed facts"
		}
		steps = append(steps, NextStep{label, "/cofounder/profile", "The AI read them from your answers or your knowledge base. Confirm, edit or dismiss each one."})
	}
	if len(o.MissingKeyTopics) > 0 {
		label := "Start the interview"
		if o.InterviewStarted {
			label = "Continue the interview"
		}
		steps = append(steps, NextStep{label, "/cofounder/interview", "Still missing: " + describeMissing(o.MissingKeyTopics) + ". You can also fill them in yourself on the Profile page."})
	}
	if o.Completion.KeyConfirmed == o.Completion.KeyTotal && o.Completion.ProposalsWaiting == 0 {
		steps = append(steps, NextStep{"Review your business profile", "/cofounder/profile", "Every key fact is confirmed. Add the other topics, or keep the facts up to date as the business changes."})
	}
	return steps
}

func describeMissing(topics []profile.TopicLabel) string {
	var named []string
	for index, topic := range topics {
		if index < missingTopicsNamed {
			named = append(named, topic.Label)
		}
	}
	if more := len(topics) - missingTopicsNamed; more > 0 {
		return strings.Join(named, ", ") + " and " + strconv.Itoa(more) + " more"
	}
	return strings.Join(named, ", ")
}

func labels(topics []profile.Topic) []profile.TopicLabel {
	named := []profile.TopicLabel{}
	for _, topic := range topics {
		named = append(named, profile.TopicLabel{Topic: topic.Key, Label: topic.Label})
	}
	return named
}
