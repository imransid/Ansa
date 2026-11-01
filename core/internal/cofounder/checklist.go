// Package cofounder is the Co-Founder's Overview page (the old
// services/cofounder-overview.ts, db/cofounder-progress.ts and
// lib/cofounder/getting-started.ts): how complete the business profile
// is, what an owner should do next, where the marketing plan stands, and
// the checklist from a first interview answer to a post's numbers. Real
// counts and real state only.
package cofounder

import (
	"strconv"

	"ansa/core/internal/profile"
)

// Step is one step of the Getting started checklist: done or not as the
// company's data says now, what was found, and the page where it is done.
type Step struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Done   bool   `json:"done"`
	Status string `json:"status"`
	Href   string `json:"href"`
}

// State is what the checklist is made from, all read for one company.
type State struct {
	InterviewStarted bool
	// As the Overview says it: no key topic missing, the AI's proposals counted.
	InterviewFinished bool
	Completion        profile.Completion
	PlanVersion       int // 0: no plan yet
	HasWrittenDraft   bool
	// Accounts connected as of now (a development stand-in counts), and how
	// many of those are stand-ins.
	ConnectedAccounts        int
	StandInAccounts          int
	AccountsNeedingReconnect int
	HasScheduledPost         bool
	HasPostNumbers           bool
}

// Checklist is the seven steps in the order a business works through them.
func Checklist(s State) []Step {
	keyConfirmed, keyTotal := s.Completion.KeyConfirmed, s.Completion.KeyTotal
	plan := "No plan yet"
	if s.PlanVersion > 0 {
		plan = "Version " + strconv.Itoa(s.PlanVersion) + " is the current plan"
	}
	return []Step{
		{"interview", "Answer the interview", s.InterviewFinished, describeInterview(s), "/cofounder/interview"},
		{"key_facts", "Confirm the key facts", keyConfirmed == keyTotal, strconv.Itoa(keyConfirmed) + " of " + strconv.Itoa(keyTotal) + " confirmed", "/cofounder/profile"},
		{"plan", "Make a marketing plan", s.PlanVersion > 0, plan, "/cofounder/strategy"},
		{"first_draft", "Write a first draft", s.HasWrittenDraft, either(s.HasWrittenDraft, "A draft is written", "Nothing written yet"), "/cofounder/studio"},
		{"account", "Connect a social account", s.ConnectedAccounts > 0, describeAccounts(s), "/cofounder/accounts"},
		{"first_post", "Schedule a first post", s.HasScheduledPost, either(s.HasScheduledPost, "A post is in the queue or went out", "Nothing scheduled yet"), "/cofounder/queue"},
		{"metrics", "See how posts did", s.HasPostNumbers, either(s.HasPostNumbers, "Numbers were read for a post", "No numbers yet"), "/cofounder/analytics"},
	}
}

func describeInterview(s State) string {
	if !s.InterviewStarted {
		return "Not started yet"
	}
	return either(s.InterviewFinished, "Covered every key fact", "Under way")
}

func describeAccounts(s State) string {
	var parts []string
	if s.ConnectedAccounts > 0 {
		standIn := ""
		if s.StandInAccounts == s.ConnectedAccounts {
			standIn = " (development stand-in)"
		}
		parts = append(parts, strconv.Itoa(s.ConnectedAccounts)+" connected"+standIn)
	}
	if s.AccountsNeedingReconnect > 0 {
		parts = append(parts, strconv.Itoa(s.AccountsNeedingReconnect)+" "+either(s.AccountsNeedingReconnect == 1, "needs", "need")+" reconnecting")
	}
	if len(parts) == 0 {
		return "None connected yet"
	}
	if len(parts) == 2 {
		return parts[0] + ", " + parts[1]
	}
	return parts[0]
}

func either(condition bool, yes, no string) string {
	if condition {
		return yes
	}
	return no
}
