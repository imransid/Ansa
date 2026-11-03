package knowledge

import (
	"context"
	"encoding/base64"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/database"
	"ansa/core/internal/documents"
	"ansa/core/internal/files"
	"ansa/core/internal/logging"
	"ansa/core/internal/menureading"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/tenant"
)

// The most text one import turns into articles (more is cut, and said),
// the longest article, and the longest title.
const (
	importedMax = 200_000
	bodyMax     = 20_000
	titleMax    = 200
)

// The words the page shows.
const (
	NoTextInFile = "No text could be read from this file; a scanned PDF has none."
	Unreadable   = "This file could not be read. It may be damaged, or not the kind of file its name says."
	// The brain reads PDFs: when it is stopped, restarting or too slow, the
	// file is not to blame.
	PDFReadingUnavailable = "Reading PDFs isn't available right now. Try again in a minute."
)

// Part is one article an imported text becomes.
type Part struct {
	Title, Body string
}

// SplitImported turns imported text into draft articles: at most 200,000
// characters (cut before a space), articles of at most 20,000 at paragraph
// boundaries, titled "<name>" or "<name> (part 2 of 3)" within 200.
func SplitImported(text, sourceName string) (parts []Part, wasCut bool) {
	runes := []rune(text)
	kept := text
	if len(runes) > importedMax {
		wasCut = true
		kept = cutBeforeLastSpace(runes[:importedMax])
	}
	bodies := PackParagraphs(kept, bodyMax)
	name := plaintext.SingleLine(sourceName)
	if name == "" {
		name = "Imported text"
	}
	for index, body := range bodies {
		suffix := ""
		if len(bodies) > 1 {
			suffix = " (part " + strconv.Itoa(index+1) + " of " + strconv.Itoa(len(bodies)) + ")"
		}
		title := []rune(name)
		if room := titleMax - utf8.RuneCountInString(suffix); len(title) > room {
			title = []rune(strings.TrimRightFunc(string(title[:room]), unicode.IsSpace))
		}
		parts = append(parts, Part{Title: string(title) + suffix, Body: body})
	}
	return parts, wasCut
}

func cutBeforeLastSpace(runes []rune) string {
	for i := len(runes) - 1; i > 0; i-- {
		if unicode.IsSpace(runes[i]) {
			return strings.TrimRightFunc(string(runes[:i]), unicode.IsSpace)
		}
	}
	return string(runes)
}

var (
	spacesAtLineEnd = regexp.MustCompile(`(?m)[ \t]+$`)
	blankRuns       = regexp.MustCompile(`\n{3,}`)
)

// NormalizeExtracted cleans text taken from a file or a web page: one kind
// of line break, no control characters but line breaks and tabs (Postgres
// refuses NUL), at most one blank line in a row, no spaces at line ends.
func NormalizeExtracted(text string) string {
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	text = strings.Map(func(r rune) rune {
		if r != '\n' && r != '\t' && unicode.Is(unicode.Cc, r) {
			return -1
		}
		return r
	}, text)
	text = spacesAtLineEnd.ReplaceAllString(text, "")
	return strings.TrimSpace(blankRuns.ReplaceAllString(text, "\n\n"))
}

// documentText reads a stored document's text by its extension: .txt, .md
// and .csv as UTF-8 (a byte order mark is no text), .docx (only its text
// part unpacked, at most 50 MB), .pdf through the brain. "" with a problem
// in the page's words.
func documentText(ctx context.Context, brain *brainclient.Client, log *logging.Logger, data []byte, extension string) (string, string) {
	raw := ""
	switch extension {
	case "txt", "md", "csv":
		if !utf8.Valid(data) {
			return "", Unreadable
		}
		raw = strings.TrimPrefix(string(data), "\uFEFF")
	case "docx":
		raw = menureading.DocxText(data)
	case "pdf":
		var answer struct {
			Kind   string `json:"kind"`
			Reason string `json:"reason"`
			Text   string `json:"text"`
		}
		if err := brain.Call(ctx, "/v1/documents/pdf-text", map[string]string{"data": base64.StdEncoding.EncodeToString(data)}, &answer); err != nil {
			// The error's type only: never the file or what is in it.
			log.Warn("knowledge: the brain couldn't read a pdf", logging.ErrorType(err))
			return "", PDFReadingUnavailable
		}
		if answer.Kind != "ok" {
			if answer.Reason == "no_text" {
				return "", NoTextInFile
			}
			return "", Unreadable
		}
		raw = answer.Text
	default:
		return "", Unreadable
	}
	text := NormalizeExtracted(raw)
	if text == "" {
		return "", NoTextInFile
	}
	return text, ""
}

// ImportDocument turns one of the company's documents into draft articles
// of kind "document" (owners only, checked again when they are saved),
// meant for support until an owner decides otherwise. Importing again makes
// new drafts. Returns how many, whether the text was cut, or a problem in
// the page's words.
func ImportDocument(ctx context.Context, pool *database.Pool, store *files.Store, brain *brainclient.Client, log *logging.Logger, company tenant.CompanyID, actorUserID, documentID string) (created int, wasCut bool, problem string, err error) {
	document, err := documents.Find(ctx, pool, company, documentID)
	if err != nil || document == nil {
		return 0, false, "Document not found.", err
	}
	data, found, err := store.Read(ctx, document.StorageKey)
	if err != nil {
		return 0, false, "The file could not be read from storage right now. Try again in a few minutes.", nil
	}
	if !found {
		return 0, false, "The file could not be found in storage.", nil
	}
	// Keys end in the extension the upload checked.
	extension := document.StorageKey[strings.LastIndex(document.StorageKey, ".")+1:]
	text, problem := documentText(ctx, brain, log, data, extension)
	if problem != "" {
		return 0, false, problem, nil
	}
	return SaveImported(ctx, pool, company, actorUserID, text, document.FileName, "document", Source{DocumentID: document.ID})
}

// SaveImported saves imported text as drafts titled after its source.
func SaveImported(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, text, sourceName, kind string, source Source) (int, bool, string, error) {
	parts, wasCut := SplitImported(text, sourceName)
	if len(parts) == 0 {
		return 0, false, NoTextInFile, nil
	}
	articles := make([]Fields, len(parts))
	for i, part := range parts {
		articles[i] = Fields{Title: part.Title, Body: part.Body, Kind: kind, UseForSupport: true}
	}
	ids, outcome, err := CreateDrafts(ctx, pool, company, actorUserID, articles, source)
	switch {
	case err != nil:
		return 0, false, "", err
	case outcome == "full":
		return 0, false, "Your company has 1,000 articles, the most there can be. Delete some first.", nil
	case outcome == "source-gone":
		return 0, false, "The document was deleted meanwhile.", nil
	case outcome != "created":
		return 0, false, "Only owners can import into knowledge.", nil
	}
	return len(ids), wasCut, "", nil
}
