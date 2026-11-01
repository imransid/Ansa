package mediagen

import (
	"context"
	"time"
	"unicode"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/files"
	"ansa/core/internal/logging"
	"ansa/core/internal/media"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/tenant"
)

// Asking for images and videos: from the media page ("Generate an image"),
// or from a draft's saved image description (the result is attached to that
// draft). Each request is saved first, then run right after the answer, so
// nobody waits on the image service. Everyone in the company may ask,
// within the company's daily limit. Nothing is asked for while it is off.

// Generations: 30 images and videos a day per company (each will be a paid
// request once a real service is chosen), the old counter.
var Generations = ratelimit.Rule{MaxAttempts: 30, Window: 24 * time.Hour}

// PromptMax is the longest prompt (a draft's image description always fits).
const PromptMax = 2_000

// The page's words.
const (
	Off            = "Image generation isn't set up yet, so nothing was asked for."
	dailyLimit     = "Your company reached its limit of 30 images and videos a day. Try again tomorrow."
	draftGone      = "We couldn't find that draft. Reload the page."
	notEditable    = "This draft's status changed meanwhile (an archived draft must be restored first). Reload the page to see it."
	draftStale     = "Someone changed this draft after you opened it, so nothing was asked for. Reload the page to see their change."
	draftBusy      = "An image for this draft is already being made."
	cantAddMedia   = "You can't add media to this company."
	wrongFormat    = "This draft takes no image of this kind."
	onlyImagePosts = "Only a post with an image gets its image made here. Attach a video from the media library instead."
	noDescription  = "Describe the image first (Image: what it shows), and save."
)

// Service asks for images and videos and runs the requests.
type Service struct {
	Pool    *database.Pool
	Files   *files.Store
	Limiter *ratelimit.Limiter
	Log     *logging.Logger
	Mode    Mode
	// Tests only: a shorter wait between polls and a shorter run budget.
	Sleep  func(time.Duration)
	Budget time.Duration
}

// CheckRequest checks "Generate an image": the kind and the prompt (a line
// break counting once); problems by field.
func CheckRequest(kind, prompt string) (string, map[string]string) {
	problems := map[string]string{}
	if kind != "image" && kind != "video" {
		problems["kind"] = "Pick an image or a video."
	}
	cleaned := contentrules.CleanDraftLines(prompt)
	switch {
	case cleaned == "":
		problems["prompt"] = "Say what the picture should show."
	case utf16Length(cleaned) > PromptMax:
		problems["prompt"] = "A prompt can be at most 2,000 characters."
	case hasControlCharacters(cleaned):
		problems["prompt"] = "Remove the invisible control characters from the text."
	case contentrules.HasTooManyMarksInARow(cleaned):
		problems["prompt"] = "Take out some accents or other marks: at most 30 can follow each other."
	}
	return cleaned, problems
}

// Request saves "Generate an image" (a checked kind and prompt) for one
// company: its job id, or why not in the page's words. The caller runs it.
func (s *Service) Request(ctx context.Context, company tenant.CompanyID, actorUserID, kind, prompt string) (string, string, error) {
	return s.create(ctx, company, actorUserID, newJob{kind: kind, prompt: prompt})
}

// RequestForDraft is "Make the image with the AI" on a post with an image:
// from its SAVED image description, at the version the page showed, to be
// attached once made while the draft is still at that version. The common
// refusals come first, so they cost nothing of the daily limit; the save
// checks them all again, locked.
func (s *Service) RequestForDraft(ctx context.Context, company tenant.CompanyID, actorUserID, draftID string, version int) (string, string, error) {
	draft, err := drafts.Read(ctx, s.Pool, company, draftID)
	switch {
	case err != nil:
		return "", "", err
	case draft == nil:
		return "", draftGone, nil
	case drafts.MediaKindOfFormat(draft.Format) != "image":
		return "", onlyImagePosts, nil
	case !drafts.In(drafts.EditableStatuses, draft.Status):
		return "", notEditable, nil
	case draft.Version != version:
		return "", draftStale, nil
	case draft.Fields.ImagePrompt == "":
		return "", noDescription, nil
	}
	open, err := OpenJobOfDraft(ctx, s.Pool, company, draftID)
	if err != nil {
		return "", "", err
	}
	if open != nil && !open.IsStuck {
		return "", draftBusy, nil
	}
	return s.create(ctx, company, actorUserID, newJob{kind: "image", prompt: draft.Fields.ImagePrompt, draftID: draftID, draftVersion: version})
}

// create saves a request after the mode, the daily limit and the cap.
func (s *Service) create(ctx context.Context, company tenant.CompanyID, actorUserID string, job newJob) (string, string, error) {
	if s.Mode.Provider == nil {
		return "", Off, nil
	}
	if over, err := s.Limiter.Over(ctx, "media-generations", company.String(), Generations); err != nil || over {
		return "", dailyLimit, err
	}
	full, err := s.libraryFullForRequests(ctx, company)
	if err != nil || full {
		return "", media.LibraryFull, err
	}
	job.provider = s.Mode.Provider.Name()
	jobID, refusal, err := createJob(ctx, s.Pool, company, actorUserID, job)
	return jobID, refusal, err
}

// libraryFullForRequests: the files stored and the requests still waiting
// or being made (each will be a file) fill the library. Its size is only
// known once made: saving it checks the bytes again, under the company lock.
func (s *Service) libraryFullForRequests(ctx context.Context, company tenant.CompanyID) (bool, error) {
	count, total, err := media.Totals(ctx, s.Pool, company)
	if err != nil {
		return false, err
	}
	var open int
	err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM media_generation_jobs WHERE company_id = $1 AND status IN ('queued', 'running')`, company.String()).Scan(&open)
	return count+open >= media.MaxAssetsPerCompany || total >= media.MaxBytesPerCompany, err
}

func hasControlCharacters(text string) bool {
	for _, r := range text {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return true
		}
	}
	return false
}

func utf16Length(text string) int {
	n := 0
	for _, r := range text {
		n++
		if r >= 0x10000 {
			n++
		}
	}
	return n
}
