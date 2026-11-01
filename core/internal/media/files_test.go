package media

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/gif"
	"image/png"
	"strings"
	"testing"
)

func pngBytes(width, height int) []byte {
	var out bytes.Buffer
	png.Encode(&out, image.NewRGBA(image.Rect(0, 0, width, height)))
	return out.Bytes()
}

// jpegBytes is a JPEG's header: an optional Exif block with an orientation
// (0: none) in either byte order, then a frame stating height and width.
func jpegBytes(width, height, orientation int, order binary.ByteOrder) []byte {
	out := []byte{0xff, 0xd8}
	if orientation > 0 {
		tiff := make([]byte, 8+2+12)
		if order == binary.LittleEndian {
			copy(tiff, "II")
		} else {
			copy(tiff, "MM")
		}
		order.PutUint16(tiff[2:], 42)
		order.PutUint32(tiff[4:], 8)
		order.PutUint16(tiff[8:], 1)
		order.PutUint16(tiff[10:], 0x0112)
		order.PutUint16(tiff[12:], 3)
		order.PutUint32(tiff[14:], 1)
		order.PutUint16(tiff[18:], uint16(orientation))
		segment := append([]byte("Exif\x00\x00"), tiff...)
		out = append(out, 0xff, 0xe1, byte((len(segment)+2)>>8), byte(len(segment)+2))
		out = append(out, segment...)
	}
	frame := []byte{0xff, 0xc0, 0, 11, 8, byte(height >> 8), byte(height), byte(width >> 8), byte(width), 3, 0, 0, 0}
	return append(out, frame...)
}

func TestEachTypeIsToldByItsOwnFirstBytes(t *testing.T) {
	var gifOut bytes.Buffer
	gif.Encode(&gifOut, image.NewPaletted(image.Rect(0, 0, 3, 2), color.Palette{color.Black, color.White}), nil)
	cases := map[string][]byte{
		"image/png":  pngBytes(2, 2),
		"image/jpeg": jpegBytes(4, 3, 0, binary.BigEndian),
		"image/gif":  gifOut.Bytes(),
		"image/webp": []byte("RIFF\x00\x00\x00\x00WEBPVP8 "),
		"video/mp4":  []byte("\x00\x00\x00\x18ftypisom\x00\x00\x00\x00"),
	}
	for want, data := range cases {
		if got := DetectType(data); got != want {
			t.Fatalf("%s: %q", want, got)
		}
	}
	for _, other := range []string{"#!/bin/sh\necho", "<svg xmlns='x'/>", "\x00\x00\x00\x18ftypheic\x00\x00", "%PDF-1.7", "\x89PN"} {
		if DetectType([]byte(other)) != "" {
			t.Fatalf("not an accepted file: %q", other)
		}
	}
}

func TestTheNameAndTheBytesMustAgree(t *testing.T) {
	data := pngBytes(2, 2)
	if _, problem := CheckFile("photo.jpg", data); problem != "This file is a PNG image, but its name ends in .jpg. Rename it to end in .png, or upload another file." {
		t.Fatalf("a PNG named .jpg: %q", problem)
	}
	if _, problem := CheckFile("photo.png", []byte("#!/bin/sh\necho hi")); problem != NotMedia {
		t.Fatalf("a script named .png: %q", problem)
	}
	if _, problem := CheckFile("logo.svg", []byte("<svg/>")); problem != SVGRefused {
		t.Fatalf("an SVG: %q", problem)
	}
	if _, problem := CheckFile("big.png", append(data, make([]byte, MaxUploadBytes)...)); problem != TooBig {
		t.Fatalf("one byte over 4 MB: %q", problem)
	}
	if _, problem := CheckFile("empty.png", nil); problem != EmptyFile {
		t.Fatalf("an empty file: %q", problem)
	}
	if contentType, problem := CheckFile("Photo.PNG", data); problem != "" || contentType != "image/png" {
		t.Fatalf("a PNG: %q %q", contentType, problem)
	}
}

func TestImageSizesAreReadAsTheImageIsShown(t *testing.T) {
	if w, h, ok := ImageSize(pngBytes(640, 480), "image/png"); !ok || w != 640 || h != 480 {
		t.Fatalf("PNG: %d x %d", w, h)
	}
	for _, order := range []binary.ByteOrder{binary.LittleEndian, binary.BigEndian} {
		if w, h, ok := ImageSize(jpegBytes(4032, 3024, 6, order), "image/jpeg"); !ok || w != 3024 || h != 4032 {
			t.Fatalf("a portrait photo (orientation 6) is as wide as it is shown: %d x %d", w, h)
		}
		if w, h, _ := ImageSize(jpegBytes(4032, 3024, 3, order), "image/jpeg"); w != 4032 || h != 3024 {
			t.Fatalf("upside down keeps its sides: %d x %d", w, h)
		}
	}
	broken := jpegBytes(400, 300, 6, binary.BigEndian)
	copy(broken[6:], "Nope")
	if w, h, _ := ImageSize(broken, "image/jpeg"); w != 400 || h != 300 {
		t.Fatalf("a broken Exif block keeps the stated sides: %d x %d", w, h)
	}
	if _, _, ok := ImageSize(jpegBytes(400, 300, 0, binary.BigEndian)[:8], "image/jpeg"); ok {
		t.Fatal("a header cut short has no size")
	}
	if _, _, ok := ImageSize([]byte("\x00\x00\x00\x18ftypisom"), "video/mp4"); ok {
		t.Fatal("a video's size isn't read")
	}
}

func TestAShownNameIsOnePlainLine(t *testing.T) {
	if name := shownName("bad\u202egpj.png\nx", "png"); strings.ContainsAny(name, "\u202e\n") {
		t.Fatalf("one plain line: %q", name)
	}
	if name := shownName("\u200b", "jpg"); name != "file.jpg" {
		t.Fatalf("nothing left: %q", name)
	}
}
