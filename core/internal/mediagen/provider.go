// Package mediagen makes images and videos for the media library (the old
// lib/media-generation.ts, services/media-generation-*.ts,
// db/media-generation-*.ts, adapters/dev-media-generator.ts): the one door
// to every image service (Provider), which one this server uses (Mode,
// from MEDIA_PROVIDER), requests saved queued and run right after the
// answer, runs CLAIMED in one UPDATE so two never work one request, results
// kept only when their own bytes are an accepted file of the kind asked
// for, Cancel and "Start now", and the periodic task that takes up stuck
// requests. No real service is chosen yet: only the development stand-in.
//
// LOGGING RULE: never the prompt, an address a service gave, a file key or
// an error message: codes and class names only.
package mediagen

import (
	"context"
	"time"
)

// Request is one image or video to make.
type Request struct {
	Kind, Prompt string
}

// Output is the finished file: its bytes, or an https address to fetch
// them from at once (a service's links expire). The type it states is
// never trusted: the bytes are checked.
type Output struct {
	Bytes []byte
	URL   string
}

// Started is a service's answer to a start: "done" (with the file),
// "started" (with its job id to poll) or "failed" (with a code).
type Started struct {
	Status        string
	Output        Output
	ProviderJobID string
	// What the service charged, when it says (nil: unknown).
	CostCents *int
	Code      string
}

// Polled is a service's answer to a poll: "running", "done" or "failed".
type Polled struct {
	Status    string
	Output    Output
	CostCents *int
	Code      string
}

// Provider is one image or video service: one adapter each. Adding one =
// its adapter, one line in ModeFor and its name in MEDIA_PROVIDER's list.
type Provider interface {
	// Stored on each job and asset (lowercase letters, digits and "-").
	Name() string
	// Not a real service: refused in production, labeled everywhere.
	IsStandIn() bool
	// What it makes: a video asked of an image-only service fails honestly.
	Kinds() []string
	// The only hosts (https, the default port) its output addresses may name.
	OutputHosts() []string
	// How long one start or poll may take, and the wait between polls.
	RequestTimeout() time.Duration
	PollInterval() time.Duration
	Start(ctx context.Context, request Request) (Started, error)
	Poll(ctx context.Context, providerJobID string) (Polled, error)
}

// Why an image or video wasn't made: the code a failed job keeps
// (media_generation_jobs.last_error, never a service's message), and the
// plain words the pages show for it.
var ErrorWords = map[string]string{
	"no_video_provider":    "The image service in use makes images only, so no video was made.",
	"provider_unavailable": "Image generation was switched off after this was asked for, so nothing was made.",
	"provider_refused":     "The image service refused this prompt (it may break the service's content rules). Try other words.",
	"provider_failed":      "The image service failed to make it. Try again.",
	"provider_timeout":     "The image service took too long to answer. Try again.",
	"unexpected_output":    "The image service sent back something that isn't an image or video of the kind asked for, so nothing was kept.",
	"output_too_large":     "What the image service sent back was too large to keep.",
	"download_failed":      "The result couldn't be fetched from the image service, so nothing was kept. Try again.",
	"storage_failed":       "The result couldn't be stored right now, so nothing was kept. Try again in a few minutes.",
	"library_full":         "Your media library was full (300 files or 500 MB in all) when it came back, so it wasn't kept. Delete something to make room, then try again.",
	"interrupted":          "The work was cut off too many times, so it was stopped. Try again.",
	"superseded":           "It was stuck, and a newer request for the same draft replaced it, so it was stopped.",
}

// DescribeError is the page's words for a stored code; one this version
// doesn't know (written by a later one) is shown as it is.
func DescribeError(code string) string {
	if words, known := ErrorWords[code]; known {
		return words
	}
	return "It failed (" + code + ")."
}
