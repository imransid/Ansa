package drafts

import "strings"

// The content of a draft and the rules about it that the content studio,
// the media library and the publishing queue share (the old
// lib/content-studio/draft-fields.ts and limits.ts). Pure.

// Limits of what a draft holds. The body holds up to Facebook's limit, the
// longest of the platforms: each platform's own limit is a rule shown on
// the page (contentrules), not a refusal.
const (
	TopicMax         = 500
	PillarMax        = 200
	CampaignMax      = 200
	TitleMax         = 100
	BodyMax          = 63_206
	CallToActionMax  = 300
	ImagePromptMax   = 2_000
	VideoScriptMax   = 10_000
	RejectionNoteMax = 500
	// The AI's claims: more is an unusable answer (a claim left out is one
	// nobody checks); each claim's text is cut to ClaimTextMax.
	ClaimsMax    = 30
	ClaimTextMax = 500
	// The approved marketing articles one draft reads (whole pieces, best
	// first, tags included), out of the search's 10 best hits.
	KnowledgeCharacters = 4_000
	KnowledgeHits       = 10
)

// Fields is what a person or the AI writes. Saving a change to any of them
// makes a new version.
type Fields struct {
	Title        string   `json:"title"`
	Body         string   `json:"body"`
	Hashtags     []string `json:"hashtags"`
	CallToAction string   `json:"callToAction"`
	ImagePrompt  string   `json:"imagePrompt"`
	VideoScript  string   `json:"videoScript"`
}

// What each change of status may start from. A scheduled draft can still
// be changed, rejected or archived (its waiting posts are canceled in the
// same transaction); a failed one too, and approved again. A published one
// stays as it went out: a new post is a new draft.
var (
	EditableStatuses   = []string{"idea", "draft", "approved", "rejected", "scheduled", "failed"}
	ApprovableStatuses = []string{"draft", "rejected", "failed"}
	RejectableStatuses = []string{"draft", "approved", "scheduled", "failed"}
	ArchivableStatuses = []string{"idea", "draft", "approved", "rejected", "scheduled", "failed"}
	// The statuses the publishing queue gives a draft: an approval keeps them.
	QueueStatuses = []string{"scheduled", "published", "failed"}
	// A draft whose image or video can't be deleted from the library:
	// approved with it, on its way out, out, or failed (the queue may retry).
	StatusesKeepingMedia = []string{"approved", "scheduled", "published", "failed"}
	// A draft whose image's alt text can't change: it is published with it.
	StatusesKeepingAltText = []string{"scheduled", "published", "failed"}
	// Every status, in the list's order.
	Statuses = []string{"idea", "draft", "approved", "rejected", "scheduled", "published", "failed", "archived"}
)

// StatusLabels are the words the pages use for each status.
var StatusLabels = map[string]string{
	"idea": "Idea", "draft": "Draft", "approved": "Approved", "rejected": "Rejected",
	"scheduled": "Scheduled", "published": "Published", "failed": "Publishing problem", "archived": "Archived",
}

// In says whether a list holds a status.
func In(list []string, status string) bool {
	for _, entry := range list {
		if entry == status {
			return true
		}
	}
	return false
}

// KeepUsedFields empties the fields a platform and format don't use: only
// YouTube has a title, only a video a script, and a text post no image
// description. The database's CHECKs refuse anything else, so every write
// goes through this.
func KeepUsedFields(platform, format string, f Fields) Fields {
	kept := f
	if platform != "youtube" {
		kept.Title = ""
	}
	if format == "post" {
		kept.ImagePrompt = ""
	}
	if format != "video" {
		kept.VideoScript = ""
	}
	if kept.Hashtags == nil {
		kept.Hashtags = []string{}
	}
	return kept
}

// HasContent says whether anything is written: then it is a draft, not an idea.
func HasContent(f Fields) bool {
	for _, text := range []string{f.Title, f.Body, f.CallToAction, f.ImagePrompt, f.VideoScript} {
		if strings.TrimSpace(text) != "" {
			return true
		}
	}
	return len(f.Hashtags) > 0
}

// StatusAfterContentChange is a draft again (any approval or rejection is
// over), or an idea when everything was cleared and nothing is attached.
func StatusAfterContentChange(f Fields, hasMedia bool) string {
	if HasContent(f) || hasMedia {
		return "draft"
	}
	return "idea"
}

// MediaKindOfFormat is what a format attaches from the media library: a
// post with an image an image, a video a video, a text post nothing ("").
func MediaKindOfFormat(format string) string {
	switch format {
	case "image_post":
		return "image"
	case "video":
		return "video"
	}
	return ""
}

// WasEditedByHand: the content is not exactly what the AI last wrote
// (someone typed or changed it): Regenerate then asks first. A change of
// the image alone carries generated_version along with the version.
func WasEditedByHand(version int, generatedVersion *int, f Fields) bool {
	return (generatedVersion == nil || *generatedVersion != version) && HasContent(f)
}
