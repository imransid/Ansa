package mediagen

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"strings"
	"testing"
)

func standInPicture(t *testing.T, prompt string) ([]byte, image.Image) {
	t.Helper()
	started, err := StandIn{}.Start(context.Background(), Request{Kind: "image", Prompt: prompt})
	if err != nil || started.Status != "done" || started.CostCents == nil || *started.CostCents != 0 {
		t.Fatalf("made at once, free: %+v %v", started, err)
	}
	picture, err := png.Decode(bytes.NewReader(started.Output.Bytes))
	if err != nil || picture.Bounds().Dx() != 1024 || picture.Bounds().Dy() != 1024 {
		t.Fatalf("a real PNG of 1024 x 1024: %v", err)
	}
	return started.Output.Bytes, picture
}

func TestTheStandInWritesThePromptOnAGradientAndMakesNoVideo(t *testing.T) {
	data, picture := standInPicture(t, "A loaf of sourdough on a wooden table")
	if picture.At(0, 0) == picture.At(1023, 1023) {
		t.Fatal("a gradient from corner to corner, never one flat colour")
	}
	// The words: pixels far darker than either end of the gradient.
	darkest := min(brightness(picture.At(0, 0)), brightness(picture.At(1023, 1023)))
	words := 0
	for y := 0; y < 1024; y += 2 {
		for x := 0; x < 1024; x += 2 {
			if brightness(picture.At(x, y)) < darkest/3 {
				words++
			}
		}
	}
	if words < 2_000 {
		t.Fatalf("the prompt's words are written on it: %d dark pixels", words)
	}
	again, _ := standInPicture(t, "A loaf of sourdough on a wooden table")
	other, _ := standInPicture(t, "A bowl of ramen")
	if !bytes.Equal(data, again) || bytes.Equal(data, other) {
		t.Fatal("the same prompt, the same picture; another prompt, another")
	}
	video, _ := StandIn{}.Start(context.Background(), Request{Kind: "video", Prompt: "A clip"})
	if video.Status != "failed" || video.Code != "no_video_provider" {
		t.Fatalf("no video, honestly: %+v", video)
	}
}

func TestTheStandInsWordsAreTheFontsAndFitThePicture(t *testing.T) {
	got := drawableWords("Tagliatelle al ragù 🍝 “fresh” – Chef’s pick\nরুটি")
	if strings.Join(got, "|") != `Tagliatelle|al|ragu|"fresh"|-|Chef's|pick` {
		t.Fatalf("accents dropped, typed quotes made plain, what the font lacks left out: %q", got)
	}
	if scale, lines := layOutWords([]string{"A", "loaf"}); scale != standInLargestScale || len(lines) != 1 || lines[0] != "A loaf" {
		t.Fatalf("a short prompt is written as large as it fits: %d %q", scale, lines)
	}
	long := strings.Fields(strings.Repeat("sourdough bread with olives and rosemary ", 6) + strings.Repeat("x", 40))
	scale, lines := layOutWords(long)
	if scale != standInSmallestScale || len(lines) != standInMaxLines || !strings.HasSuffix(lines[len(lines)-1], "...") {
		t.Fatalf("a long prompt is cut after the lines that fit, with ...: %d %q", scale, lines)
	}
	for _, line := range lines {
		if len(line) > lettersPerLine(scale) || (len(line)*letterAdvance-1)*scale > standInSide-2*standInMargin {
			t.Fatalf("every line fits inside the margin: %q", line)
		}
	}
	word := strings.Repeat("y", 30)
	if scale, lines := layOutWords([]string{word}); len(lines) < 2 || len(lines[0]) != lettersPerLine(scale) || strings.Join(lines, "") != word {
		t.Fatalf("a word longer than a line is cut where the line ends: %q", lines)
	}
	// Another script only: the gradient alone, still a real picture.
	standInPicture(t, "রুটি আর ডাল")
}

func TestTheFontHasEveryPrintableASCIICharacter(t *testing.T) {
	for letter := rune(' '); letter <= '~'; letter++ {
		rows := glyph(letter)
		if !hasGlyph(letter) || (letter != ' ' && (len(rows) < glyphBaseline || len(rows) > glyphHeight)) {
			t.Fatalf("%q: a glyph of 7 to 9 rows", letter)
		}
		if len(rows) > glyphBaseline && !strings.ContainsRune("gjpqy,;", letter) {
			t.Fatalf("%q: only g, j, p, q, y, the comma and the semicolon have tails", letter)
		}
		for _, row := range rows {
			if len(row) != glyphWidth || strings.Trim(row, "#.") != "" {
				t.Fatalf("%q: rows of 5 pixels, # or .", letter)
			}
		}
	}
}

func TestTheWordsReadOnEitherEndOfEveryGradient(t *testing.T) {
	for index := range 500 {
		colors := standInColorsOf(fmt.Sprintf("prompt %d", index))
		if contrast(colors.ink, colors.from) < 4.5 || contrast(colors.ink, colors.to) < 4.5 {
			t.Fatalf("prompt %d: the ink reads on both ends (WCAG 4.5:1): %v", index, colors)
		}
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

// brightness: the average of a colour's red, green and blue, 0 to 255.
func brightness(c color.Color) float64 {
	r, g, b, _ := c.RGBA()
	return float64(r>>8+g>>8+b>>8) / 3
}

// contrast is WCAG's contrast ratio of two colours (1 to 21).
func contrast(one, two color.RGBA) float64 {
	lighter, darker := luminance(one), luminance(two)
	if darker > lighter {
		lighter, darker = darker, lighter
	}
	return (lighter + 0.05) / (darker + 0.05)
}

func luminance(c color.RGBA) float64 {
	linear := func(channel uint8) float64 {
		value := float64(channel) / 255
		if value <= 0.04045 {
			return value / 12.92
		}
		return math.Pow((value+0.055)/1.055, 2.4)
	}
	return 0.2126*linear(c.R) + 0.7152*linear(c.G) + 0.0722*linear(c.B)
}
