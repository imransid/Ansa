package mediagen

import (
	"bytes"
	"crypto/sha256"
	"image"
	"image/color"
	"image/png"
	"math"
)

// standInSide: the stand-in's images are 1024 x 1024 pixels.
const standInSide = 1024

// StandInPNG is the stand-in's picture for a prompt: a 1024 x 1024 PNG, a
// soft gradient in two colours picked from the prompt's SHA-256, with the
// prompt's first words written on it in the stand-in's pixel font
// (standin_words.go). The same prompt always gives the same picture.
func StandInPNG(prompt string) ([]byte, error) {
	colors := standInColorsOf(prompt)
	picture := image.NewRGBA(image.Rect(0, 0, standInSide, standInSide))
	paintGradient(picture, colors.from, colors.to)
	scale, lines := layOutWords(drawableWords(prompt))
	writeLines(picture, lines, scale, colors.ink)
	var out bytes.Buffer
	if err := png.Encode(&out, picture); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// standInColors: the gradient's two ends and the colour of the words.
type standInColors struct{ from, to, ink color.RGBA }

// standInColorsOf picks soft colours from the prompt's SHA-256: two light
// hues 35 to 94 degrees apart, and a deep shade of the first for the words,
// dark enough to read on both.
func standInColorsOf(prompt string) standInColors {
	hash := sha256.Sum256([]byte(prompt))
	hue := float64(int(hash[0])<<8|int(hash[1])) / 65536 * 360
	saturation := 0.55 + float64(hash[3])/255*0.2
	return standInColors{
		from: colorOfHSL(hue, saturation, 0.80+float64(hash[4])/255*0.06),
		to:   colorOfHSL(hue+35+float64(hash[2]%60), saturation, 0.76+float64(hash[5])/255*0.06),
		ink:  colorOfHSL(hue, 0.4, 0.17),
	}
}

// colorOfHSL turns a hue (in degrees), a saturation and a lightness (0 to 1)
// into a colour.
func colorOfHSL(hue, saturation, lightness float64) color.RGBA {
	chroma := (1 - math.Abs(2*lightness-1)) * saturation
	sector := math.Mod(hue, 360) / 60
	second := chroma * (1 - math.Abs(math.Mod(sector, 2)-1))
	var red, green, blue float64
	switch {
	case sector < 1:
		red, green = chroma, second
	case sector < 2:
		red, green = second, chroma
	case sector < 3:
		green, blue = chroma, second
	case sector < 4:
		green, blue = second, chroma
	case sector < 5:
		red, blue = second, chroma
	default:
		red, blue = chroma, second
	}
	lift := lightness - chroma/2
	return color.RGBA{R: toByte(red + lift), G: toByte(green + lift), B: toByte(blue + lift), A: 255}
}

// toByte turns a share of a colour channel (0 to 1) into its byte.
func toByte(share float64) uint8 { return uint8(math.Round(share * 255)) }

// paintGradient fills the picture from one colour in its top left corner to
// the other in its bottom right corner.
func paintGradient(picture *image.RGBA, from, to color.RGBA) {
	farthest := float64(2 * (standInSide - 1))
	for y := 0; y < standInSide; y++ {
		for x := 0; x < standInSide; x++ {
			share := float64(x+y) / farthest
			offset := picture.PixOffset(x, y)
			picture.Pix[offset] = mix(from.R, to.R, share)
			picture.Pix[offset+1] = mix(from.G, to.G, share)
			picture.Pix[offset+2] = mix(from.B, to.B, share)
			picture.Pix[offset+3] = 255
		}
	}
}

// mix is the channel value a share (0 to 1) of the way from one byte to another.
func mix(from, to uint8, share float64) uint8 {
	return uint8(math.Round(float64(from) + (float64(to)-float64(from))*share))
}
