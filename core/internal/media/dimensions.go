package media

import "encoding/binary"

// An image's width and height as its own header states them, as it is
// shown (a JPEG turned by its Exif orientation: a phone's portrait photo is
// stored 4032 x 3024 with orientation 6). Unknown (ok=false) for a video,
// or a header cut short or odd. Every read is bounds-checked: the bytes
// come from a stranger or an outside service (the old lib/media/dimensions.ts).

// The largest side stored (the database's CHECK says the same).
const maxImageSide = 100_000

// JPEG markers that start a frame and state its size (SOF0-SOF15 without
// DHT 0xC4, JPG 0xC8 and DAC 0xCC).
var jpegFrameMarkers = map[byte]bool{0xc0: true, 0xc1: true, 0xc2: true, 0xc3: true, 0xc5: true, 0xc6: true, 0xc7: true,
	0xc9: true, 0xca: true, 0xcb: true, 0xcd: true, 0xce: true, 0xcf: true}

// ImageSize is the size of an image of this (already checked) type.
func ImageSize(data []byte, contentType string) (width, height int, ok bool) {
	switch contentType {
	case "image/png":
		if len(data) < 24 || string(data[12:16]) != "IHDR" {
			return 0, 0, false
		}
		return sized(int(binary.BigEndian.Uint32(data[16:])), int(binary.BigEndian.Uint32(data[20:])))
	case "image/gif":
		if len(data) < 10 {
			return 0, 0, false
		}
		return sized(int(binary.LittleEndian.Uint16(data[6:])), int(binary.LittleEndian.Uint16(data[8:])))
	case "image/webp":
		return webpSize(data)
	case "image/jpeg":
		return jpegSize(data)
	}
	return 0, 0, false
}

// webpSize: the first chunk says which of WebP's three formats it is, and
// each keeps the size its own way.
func webpSize(data []byte) (int, int, bool) {
	if len(data) < 30 {
		return 0, 0, false
	}
	switch string(data[12:16]) {
	case "VP8X":
		return sized(uint24(data[24:])+1, uint24(data[27:])+1)
	case "VP8L":
		if data[20] != 0x2f {
			return 0, 0, false
		}
		bits := binary.LittleEndian.Uint32(data[21:])
		return sized(int(bits&0x3fff)+1, int((bits>>14)&0x3fff)+1)
	case "VP8 ":
		if data[23] != 0x9d || data[24] != 0x01 || data[25] != 0x2a {
			return 0, 0, false
		}
		return sized(int(binary.LittleEndian.Uint16(data[26:])&0x3fff), int(binary.LittleEndian.Uint16(data[28:])&0x3fff))
	}
	return 0, 0, false
}

// jpegSize walks the segments ("FF <marker> <length>") to the frame header,
// which holds the height and then the width; an Exif block before it that
// turns the picture a quarter (orientations 5-8) swaps them. Each step
// moves forward, so the walk ends within the file.
func jpegSize(data []byte) (int, int, bool) {
	offset, orientation := 2, 0
	for offset+4 <= len(data) {
		if data[offset] != 0xff {
			return 0, 0, false
		}
		marker := data[offset+1]
		switch {
		case marker == 0xff:
			offset++
			continue
		case marker == 0xd8 || marker == 0x01 || (marker >= 0xd0 && marker <= 0xd7):
			offset += 2
			continue
		case marker == 0xd9 || marker == 0xda:
			return 0, 0, false
		case jpegFrameMarkers[marker]:
			if offset+9 > len(data) {
				return 0, 0, false
			}
			width, height := int(binary.BigEndian.Uint16(data[offset+7:])), int(binary.BigEndian.Uint16(data[offset+5:]))
			if orientation >= 5 {
				return sized(height, width)
			}
			return sized(width, height)
		}
		length := int(binary.BigEndian.Uint16(data[offset+2:]))
		if length < 2 {
			return 0, 0, false
		}
		if marker == 0xe1 && orientation == 0 {
			orientation = exifOrientation(data[offset+4 : min(len(data), offset+2+length)])
		}
		offset += 2 + length
	}
	return 0, 0, false
}

// exifOrientation is the orientation (1-8) one APP1 segment states (its
// bytes after the length), or 0: no Exif block, no orientation, cut short.
func exifOrientation(segment []byte) int {
	if len(segment) < 14 || string(segment[:6]) != "Exif\x00\x00" {
		return 0
	}
	tiff := segment[6:]
	var order binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 0
	}
	if order.Uint16(tiff[2:]) != 42 {
		return 0
	}
	directory := int(order.Uint32(tiff[4:]))
	if directory < 0 || directory+2 > len(tiff) {
		return 0
	}
	entries := int(order.Uint16(tiff[directory:]))
	for index := range entries {
		entry := directory + 2 + index*12
		if entry+12 > len(tiff) {
			return 0
		}
		if order.Uint16(tiff[entry:]) == 0x0112 {
			// A SHORT (type 3) at the start of the entry's last four bytes.
			orientation := int(order.Uint16(tiff[entry+8:]))
			if order.Uint16(tiff[entry+2:]) == 3 && orientation >= 1 && orientation <= 8 {
				return orientation
			}
			return 0
		}
	}
	return 0
}

func sized(width, height int) (int, int, bool) {
	if width < 1 || height < 1 || width > maxImageSide || height > maxImageSide {
		return 0, 0, false
	}
	return width, height, true
}

func uint24(data []byte) int {
	return int(data[0]) | int(data[1])<<8 | int(data[2])<<16
}
