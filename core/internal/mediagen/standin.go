package mediagen

import (
	"context"
	"time"
)

// StandInName is the provider the development stand-in records on its
// jobs and assets (shown as "Development stand-in").
const StandInName = "dev-stand-in"

// StandIn is not a real service: the image maker used in development
// whenever MEDIA_PROVIDER is not set (refused in production). It draws a
// real PNG (StandInPNG): a soft gradient in two colours picked from the
// prompt, with the prompt's first words written on it, so the same prompt
// always gives the same picture, and one an audience sees was made for
// those words (a flat colour looked like a broken feature). It makes no
// videos: a video request fails honestly with "no_video_provider". Nothing
// leaves this machine, and it costs nothing.
type StandIn struct{}

func (StandIn) Name() string                  { return StandInName }
func (StandIn) IsStandIn() bool               { return true }
func (StandIn) Kinds() []string               { return []string{"image"} }
func (StandIn) OutputHosts() []string         { return nil }
func (StandIn) RequestTimeout() time.Duration { return 10 * time.Second }
func (StandIn) PollInterval() time.Duration   { return time.Second }

// Start makes the image at once (or refuses a video).
func (StandIn) Start(_ context.Context, request Request) (Started, error) {
	if request.Kind == "video" {
		return Started{Status: "failed", Code: "no_video_provider"}, nil
	}
	data, err := StandInPNG(request.Prompt)
	if err != nil {
		return Started{}, err
	}
	free := 0
	return Started{Status: "done", Output: Output{Bytes: data}, CostCents: &free}, nil
}

// Poll: the stand-in never hands out a job id, so there is nothing to ask about.
func (StandIn) Poll(context.Context, string) (Polled, error) {
	return Polled{Status: "failed", Code: "provider_failed"}, nil
}
