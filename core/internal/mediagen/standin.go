package mediagen

import (
	"bytes"
	"context"
	"crypto/sha256"
	"image"
	"image/color"
	"image/png"
	"time"
)

// StandInName is the provider the development stand-in records on its
// jobs and assets (shown as "Development stand-in").
const StandInName = "dev-stand-in"

// standInSide: the stand-in's images are 1024 x 1024 pixels.
const standInSide = 1024

// StandIn is not a real service: the image maker used in development
// whenever MEDIA_PROVIDER is not set (refused in production). It makes a
// real PNG in one flat colour picked from the prompt, so the same prompt
// always gives the same colour, and it makes no videos: a video request
// fails honestly with "no_video_provider". Nothing leaves this machine,
// and it costs nothing.
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
	data, err := FlatColorPNG(ColorOfPrompt(request.Prompt))
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

// ColorOfPrompt is three bytes of the prompt's SHA-256: red, green, blue.
func ColorOfPrompt(prompt string) color.RGBA {
	hash := sha256.Sum256([]byte(prompt))
	return color.RGBA{R: hash[0], G: hash[1], B: hash[2], A: 255}
}

// FlatColorPNG is a PNG of 1024 x 1024 pixels, all one colour.
func FlatColorPNG(fill color.RGBA) ([]byte, error) {
	picture := image.NewRGBA(image.Rect(0, 0, standInSide, standInSide))
	for offset := 0; offset < len(picture.Pix); offset += 4 {
		picture.Pix[offset], picture.Pix[offset+1], picture.Pix[offset+2], picture.Pix[offset+3] = fill.R, fill.G, fill.B, fill.A
	}
	var out bytes.Buffer
	if err := png.Encode(&out, picture); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
