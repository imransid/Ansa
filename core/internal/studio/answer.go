package studio

import (
	"ansa/core/internal/contentrules"
	"ansa/core/internal/drafts"
)

// Reading the brain's draft (the old lib/content-studio/draft-answer.ts).
// The brain reads the model's answer strictly (exactly the fields asked
// for: no claim's "supported", no company or draft); core then cleans and
// cuts every text to what a draft holds (never to a platform's limit,
// which is a rule shown on the page) and decides which claims a confirmed
// fact backs: never the AI.

// brainAnswer is the brain's answer: ok with the draft, or why not.
type brainAnswer struct {
	Kind      string      `json:"kind"`
	Reason    string      `json:"reason"`
	ErrorName string      `json:"error_name"`
	Draft     *brainDraft `json:"draft"`
}

type brainDraft struct {
	Title        string       `json:"title"`
	Body         string       `json:"body"`
	Hashtags     []string     `json:"hashtags"`
	CallToAction string       `json:"call_to_action"`
	ImagePrompt  string       `json:"image_prompt"`
	VideoScript  string       `json:"video_script"`
	Claims       []brainClaim `json:"claims"`
}

type brainClaim struct {
	Text       string   `json:"text"`
	FactTopics []string `json:"fact_topics"`
}

// readAnswer is the draft as it may be saved, or nil when there is none to
// save: missing, too many claims, or without its main text (a post's body,
// a YouTube video's title). sent: the topics of the confirmed facts sent.
func readAnswer(answer *brainDraft, r DraftRequest, sent map[string]bool) *Generated {
	if answer == nil || len(answer.Claims) > drafts.ClaimsMax {
		return nil
	}
	fields := drafts.KeepUsedFields(r.Platform, r.Format, drafts.Fields{
		Title:        cleanModelLine(answer.Title, drafts.TitleMax),
		Body:         cleanModelLines(answer.Body, drafts.BodyMax),
		Hashtags:     contentrules.CleanModelHashtags(answer.Hashtags),
		CallToAction: cleanModelLine(answer.CallToAction, drafts.CallToActionMax),
		ImagePrompt:  cleanModelLines(answer.ImagePrompt, drafts.ImagePromptMax),
		VideoScript:  cleanModelLines(answer.VideoScript, drafts.VideoScriptMax),
	})
	mainText := fields.Body
	if r.Platform == "youtube" {
		mainText = fields.Title
	}
	if mainText == "" {
		return nil
	}
	var claims []drafts.StoredClaim
	for _, claim := range answer.Claims {
		if text := cleanClaimText(claim.Text); text != "" {
			claims = append(claims, drafts.StoredClaim{Text: text, FactTopics: claim.FactTopics})
		}
	}
	return &Generated{Fields: fields, Claims: drafts.MarkClaims(claims, sent)}
}
