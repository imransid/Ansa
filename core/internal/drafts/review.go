package drafts

import (
	"encoding/json"

	"ansa/core/internal/contentrules"
)

// What an owner must know before approving one draft (the old
// lib/content-studio/review.ts and claims.ts): the platform's rules, the
// claims, and whether "I checked these claims" must be ticked. ONE
// function, so the draft's page and the approval (inside the transaction
// that writes) decide the same way. THIS code decides which claims a
// confirmed fact backs, never the AI. Pure.

// A claim's status: backed (a confirmed fact sent with the request states
// it, unchanged since), no_fact (the AI named none), fact_not_confirmed
// (one named wasn't confirmed or sent), fact_changed (a fact it names
// says something else now).
const (
	ClaimBacked           = "backed"
	ClaimNoFact           = "no_fact"
	ClaimFactNotConfirmed = "fact_not_confirmed"
	ClaimFactChanged      = "fact_changed"
)

// StoredClaim is a claim as content_drafts.claims stores it.
type StoredClaim struct {
	Text       string   `json:"text"`
	Supported  bool     `json:"supported"`
	FactTopics []string `json:"fact_topics"`
}

// ClaimFact is a fact a claim names, with the value the draft was written
// from (nil: that fact wasn't among the confirmed facts sent).
type ClaimFact struct {
	Topic string  `json:"topic"`
	Label string  `json:"label"`
	Value *string `json:"value"`
}

// CheckedClaim is a stored claim checked again now.
type CheckedClaim struct {
	Text   string      `json:"text"`
	Status string      `json:"status"`
	Facts  []ClaimFact `json:"facts"`
}

// Review is what the draft's page shows and the approval decides on.
type Review struct {
	Issues         []contentrules.Issue `json:"issues"`
	BlockingIssues []contentrules.Issue `json:"blockingIssues"`
	Claims         []CheckedClaim       `json:"claims"`
	// current: the AI listed the claims of the text as it is now. edited:
	// someone changed the text since. written_by_hand: the AI never wrote it.
	ClaimsState string `json:"claimsState"`
	// "I checked these claims" must be ticked to approve.
	AcknowledgmentNeeded bool     `json:"acknowledgmentNeeded"`
	WordsToAvoid         []string `json:"wordsToAvoid"`
}

// ForReview is what the review reads of a draft.
type ForReview struct {
	Platform, Format string
	Fields           Fields
	Version          int
	GeneratedVersion *int
	// As stored: content_drafts.claims and facts_used.
	Claims, FactsUsed json.RawMessage
	// The image or video attached, with its alt text (nil: none).
	Media *contentrules.Media
}

// ReviewDraft reviews a draft against the confirmed facts as they are now.
// WHY "edited" and "written_by_hand" need the tick too: the AI's list
// describes the text it wrote, and a claim someone typed in is a claim no
// code has checked.
func ReviewDraft(d ForReview, factsNow map[string]string) Review {
	wordsToAvoid := contentrules.ReadWordsToAvoid(factsNow["words_to_avoid"])
	rules := contentrules.Draft{Platform: d.Platform, Format: d.Format, Title: d.Fields.Title, Body: d.Fields.Body,
		CallToAction: d.Fields.CallToAction, VideoScript: d.Fields.VideoScript, Hashtags: d.Fields.Hashtags}
	issues := contentrules.CheckDraft(rules, d.Media, wordsToAvoid)
	review := Review{Issues: orEmpty(issues), BlockingIssues: []contentrules.Issue{}, Claims: []CheckedClaim{}, WordsToAvoid: orEmptyWords(wordsToAvoid)}
	for _, issue := range issues {
		if issue.Severity == contentrules.Blocking {
			review.BlockingIssues = append(review.BlockingIssues, issue)
		}
	}
	stored, fits := ReadStoredClaims(d.Claims)
	if fits {
		review.Claims = CheckClaims(stored, ReadFactsUsed(d.FactsUsed), factsNow)
	}
	review.ClaimsState = claimsState(d.Version, d.GeneratedVersion)
	review.AcknowledgmentNeeded = review.ClaimsState != "current" || !fits
	for _, claim := range review.Claims {
		review.AcknowledgmentNeeded = review.AcknowledgmentNeeded || claim.Status != ClaimBacked
	}
	return review
}

func claimsState(version int, generatedVersion *int) string {
	switch {
	case generatedVersion == nil:
		return "written_by_hand"
	case *generatedVersion == version:
		return "current"
	}
	return "edited"
}

func orEmpty(issues []contentrules.Issue) []contentrules.Issue {
	if issues == nil {
		return []contentrules.Issue{}
	}
	return issues
}

func orEmptyWords(words []string) []string {
	if words == nil {
		return []string{}
	}
	return words
}
