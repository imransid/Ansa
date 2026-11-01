package studio

import (
	"ansa/core/internal/contentrules"
	"ansa/core/internal/drafts"
)

// What the content studio's forms send, checked (the old
// lib/validation/content-drafts.ts). There is deliberately no company,
// person, status, approval or claim here: the company and the person come
// from the session, the writes set the status and the version, only an
// owner's own Approve approves, and only the AI's answer (checked by core)
// lists claims. Problems are by field, in the page's words.

// Placement is what a draft is about: its topic, and the plan's pillar
// and campaign by name ("" = none).
type Placement struct {
	Topic, Pillar, Campaign string
}

// NewDraftForm is "New draft": the platform, a format it takes, the topic,
// and the plan's pillar and campaign.
type NewDraftForm struct {
	Platform string `json:"platform"`
	Format   string `json:"format"`
	Topic    string `json:"topic"`
	Pillar   string `json:"pillar"`
	Campaign string `json:"campaign"`
}

// NewDraft is a checked "New draft".
type NewDraft struct {
	Platform, Format string
	Placement        Placement
}

// CheckNewDraft checks "New draft"; problems by field (none: it may be saved).
func CheckNewDraft(form NewDraftForm) (NewDraft, map[string]string) {
	problems := map[string]string{}
	if !contentrules.Takes(contentrules.Platforms, form.Platform) {
		problems["platform"] = "Pick a platform."
	}
	if !contentrules.Takes(contentrules.Formats, form.Format) {
		problems["format"] = "Pick a format."
	} else if problems["platform"] == "" && !contentrules.Takes(contentrules.PlatformRules[form.Platform].Formats, form.Format) {
		problems["format"] = "This platform takes " + contentrules.DescribeAcceptedFormats(form.Platform) + "."
	}
	placement := checkPlacement(form.Topic, form.Pillar, form.Campaign, problems)
	return NewDraft{Platform: form.Platform, Format: form.Format, Placement: placement}, problems
}

// EditForm is the editor: every field it shows (the hashtags as typed).
type EditForm struct {
	Topic        string `json:"topic"`
	Pillar       string `json:"pillar"`
	Campaign     string `json:"campaign"`
	Title        string `json:"title"`
	Body         string `json:"body"`
	Hashtags     string `json:"hashtags"`
	CallToAction string `json:"callToAction"`
	ImagePrompt  string `json:"imagePrompt"`
	VideoScript  string `json:"videoScript"`
}

// CheckEdit checks the editor's fields; problems by field.
func CheckEdit(form EditForm) (Placement, drafts.Fields, map[string]string) {
	problems := map[string]string{}
	placement := checkPlacement(form.Topic, form.Pillar, form.Campaign, problems)
	var fields drafts.Fields
	fields.Title = field(problems, "title")(oneLine(form.Title, drafts.TitleMax, "A title"))
	fields.Body = field(problems, "body")(severalLines(form.Body, drafts.BodyMax, "The text"))
	hashtags, problem := hashtagsBox(form.Hashtags)
	if problem != "" {
		problems["hashtags"] = problem
	}
	fields.Hashtags = hashtags
	fields.CallToAction = field(problems, "callToAction")(oneLine(form.CallToAction, drafts.CallToActionMax, "A call to action"))
	fields.ImagePrompt = field(problems, "imagePrompt")(severalLines(form.ImagePrompt, drafts.ImagePromptMax, "An image description"))
	fields.VideoScript = field(problems, "videoScript")(severalLines(form.VideoScript, drafts.VideoScriptMax, "A video script"))
	return placement, fields, problems
}

// CheckRejectionNote is an owner's note when rejecting (blank = none).
func CheckRejectionNote(note string) (*string, string) {
	cleaned, problem := severalLines(note, drafts.RejectionNoteMax, "A note")
	if problem != "" || cleaned == "" {
		return nil, problem
	}
	return &cleaned, ""
}

func checkPlacement(topic, pillar, campaign string, problems map[string]string) Placement {
	var placement Placement
	placement.Topic = field(problems, "topic")(oneLine(topic, drafts.TopicMax, "A topic"))
	if problems["topic"] == "" && placement.Topic == "" {
		problems["topic"] = "Say what the post is about."
	}
	placement.Pillar = field(problems, "pillar")(oneLine(pillar, drafts.PillarMax, "A pillar"))
	placement.Campaign = field(problems, "campaign")(oneLine(campaign, drafts.CampaignMax, "A campaign"))
	return placement
}

// field records a field's problem, if any, and gives back its value.
func field(problems map[string]string, name string) func(value, problem string) string {
	return func(value, problem string) string {
		if problem != "" {
			problems[name] = problem
		}
		return value
	}
}
