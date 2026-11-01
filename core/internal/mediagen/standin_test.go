package mediagen

import (
	"bytes"
	"context"
	"image/png"
	"testing"
)

func TestTheStandInMakesAFlatPNGFromThePromptAndNoVideo(t *testing.T) {
	started, err := StandIn{}.Start(context.Background(), Request{Kind: "image", Prompt: "A loaf"})
	if err != nil || started.Status != "done" || started.CostCents == nil || *started.CostCents != 0 {
		t.Fatalf("made at once, free: %+v %v", started, err)
	}
	picture, err := png.Decode(bytes.NewReader(started.Output.Bytes))
	if err != nil || picture.Bounds().Dx() != 1024 || picture.Bounds().Dy() != 1024 {
		t.Fatalf("a real PNG of 1024 x 1024: %v", err)
	}
	r, g, b, _ := picture.At(512, 512).RGBA()
	want := ColorOfPrompt("A loaf")
	if uint8(r>>8) != want.R || uint8(g>>8) != want.G || uint8(b>>8) != want.B || ColorOfPrompt("A loaf") != want {
		t.Fatal("the same prompt, the same colour")
	}
	video, _ := StandIn{}.Start(context.Background(), Request{Kind: "video", Prompt: "A clip"})
	if video.Status != "failed" || video.Code != "no_video_provider" {
		t.Fatalf("no video, honestly: %+v", video)
	}
}

func TestProductionRefusesTheStandIn(t *testing.T) {
	if ModeFor("", true).Provider != nil || ModeFor(StandInName, true).Provider != nil {
		t.Fatal("production without a real service is off, even when the stand-in is named")
	}
	development := ModeFor("", false)
	if development.Provider == nil || !development.Availability().IsStandIn || development.Availability().MakesVideo {
		t.Fatal("development without a setting uses the stand-in, which makes images only")
	}
	if development.ProviderForJob("another-service") != nil || development.ProviderForJob(StandInName) == nil {
		t.Fatal("a job runs only on the service it was asked of")
	}
}
