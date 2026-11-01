// Package media is the Co-Founder's media library (the old
// services/media-library.ts, media-deletion.ts, media-files.ts, draft-media.ts,
// db/media-*.ts, db/content-draft-media.ts, lib/media/): uploaded and
// generated images and videos of one company in private storage under
// media/<companyId>/<assetId>.<ext>, their alt text (published with them),
// deleting them, and attaching them to drafts. Everyone in the company uses
// it, as they use the studio. Generation: package mediagen.
//
// LOGGING RULE: never a file name, a file key, alt text or an error message.
package media

import (
	"regexp"
	"strings"
)

// Limits (the old lib/media/limits.ts). Uploads stay under Vercel's request
// limit; each company keeps at most 300 files and 500 MB, uploads and
// generated ones together, so no account fills ansa's bucket.
const (
	MaxUploadBytes      = 4 << 20
	MaxAssetsPerCompany = 300
	MaxBytesPerCompany  = 500 << 20
	MaxGeneratedBytes   = 100 << 20
	AltTextMax          = 1_000
	OriginalNameMax     = 200
	// A draft's page offers this many of the newest of its kind.
	ChoicesShown = 24
	// How long a signed link to a file works.
	LinkSeconds = 5 * 60
	// The library lists this many to a page, newest first.
	PageSize = 50
)

// The only types stored and served (never SVG: it can carry scripts), the
// kind of each and the extension its stored file gets.
var (
	KindOfType      = map[string]string{"image/png": "image", "image/jpeg": "image", "image/webp": "image", "image/gif": "image", "video/mp4": "video"}
	ExtensionOfType = map[string]string{"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4"}
	// The type each accepted name ending promises; the bytes must then agree.
	typeOfExtension = map[string]string{"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "gif": "image/gif", "mp4": "video/mp4"}
	whatTheFileIs   = map[string]string{"image/png": "a PNG image", "image/jpeg": "a JPEG image", "image/webp": "a WebP image", "image/gif": "a GIF image", "video/mp4": "an MP4 video"}
)

// The page's words (the same as the browser's own check).
const (
	EmptyFile   = "Choose an image or a video to upload."
	WrongType   = "Upload a PNG, JPEG, WebP or GIF image, or an MP4 video."
	SVGRefused  = "SVG images can't be uploaded: they can carry scripts. Save it as a PNG and upload that."
	TooBig      = "Files can be at most 4 MB."
	NotMedia    = "This file isn't a PNG, JPEG, WebP, GIF or MP4 file, whatever its name says."
	LibraryFull = "Your media library is full (300 files or 500 MB in all). Delete something to make room."
)

var extensionPattern = regexp.MustCompile(`(?i)\.([a-z0-9]+)$`)

// CheckFile says whether a file can be uploaded, from its name, its size
// and its own first bytes: the type stored for it, or why not.
func CheckFile(name string, data []byte) (contentType, problem string) {
	if len(data) == 0 {
		return "", EmptyFile
	}
	extension := ""
	if match := extensionPattern.FindStringSubmatch(name); match != nil {
		extension = strings.ToLower(match[1])
	}
	if extension == "svg" || extension == "svgz" {
		return "", SVGRefused
	}
	promised, known := typeOfExtension[extension]
	switch {
	case !known:
		return "", WrongType
	case len(data) > MaxUploadBytes:
		return "", TooBig
	}
	actual := DetectType(data)
	if actual == "" {
		return "", NotMedia
	}
	if actual != promised {
		return "", "This file is " + whatTheFileIs[actual] + ", but its name ends in ." + extension + ". Rename it to end in ." +
			ExtensionOfType[actual] + ", or upload another file."
	}
	return actual, ""
}

// Still images in the same "ftyp" box as an MP4 (HEIF and AVIF photos): a
// browser can't play them as a video, so they aren't one.
var stillImageBrands = map[string]bool{"heic": true, "heix": true, "heim": true, "heis": true, "mif1": true, "msf1": true, "avif": true, "avis": true}

// DetectType is the accepted type these bytes start, or "" (a script, an
// SVG, a PDF, a HEIF photo, too few bytes...). WHY not the name or the
// browser's type: both say whatever the sender wants.
func DetectType(data []byte) string {
	switch {
	case hasAt(data, "\x89PNG\r\n\x1a\n", 0):
		return "image/png"
	case hasAt(data, "\xff\xd8\xff", 0):
		return "image/jpeg"
	case hasAt(data, "GIF87a", 0) || hasAt(data, "GIF89a", 0):
		return "image/gif"
	case hasAt(data, "RIFF", 0) && hasAt(data, "WEBP", 8):
		return "image/webp"
	case hasAt(data, "ftyp", 4) && len(data) >= 12 && !stillImageBrands[string(data[8:12])]:
		return "video/mp4"
	}
	return ""
}

func hasAt(data []byte, text string, offset int) bool {
	return len(data) >= offset+len(text) && string(data[offset:offset+len(text)]) == text
}

// StorageKey is where a file is stored: built from ids only, the company
// first, so every company's files stay apart (the database's CHECK refuses
// any other key).
func StorageKey(companyID, assetID, contentType string) string {
	return "media/" + companyID + "/" + assetID + "." + ExtensionOfType[contentType]
}
