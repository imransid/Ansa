package menureading

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"io"
	"strings"
	"unicode"
)

// FileMaxBytes is the biggest file a menu may be (Vercel's request limit, as documents).
const FileMaxBytes = 4 << 20

// docxTextMaxBytes caps how much of a Word file's text part is ever
// unpacked, whatever its zip headers claim (a zip bomb stops here).
const docxTextMaxBytes = 50 << 20

// MediaType is what a file is by its own first bytes (never its name):
// a photo, a PDF, a zip (a Word file, by its name), or "".
func MediaType(data []byte) string {
	switch {
	case bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF}):
		return "image/jpeg"
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		return "image/png"
	case bytes.HasPrefix(data, []byte("GIF87a")) || bytes.HasPrefix(data, []byte("GIF89a")):
		return "image/gif"
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "image/webp"
	case bytes.HasPrefix(data, []byte("%PDF-")):
		return "application/pdf"
	case bytes.HasPrefix(data, []byte("PK\x03\x04")):
		return "application/zip"
	}
	return ""
}

// DocxText is the text of a Word file (word/document.xml): each paragraph
// a line, tabs kept, control characters out, blank lines tidied. Only that
// one part is unpacked, never more than docxTextMaxBytes. "" = none.
func DocxText(data []byte) string {
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return ""
	}
	for _, file := range archive.File {
		if file.Name != "word/document.xml" {
			continue
		}
		part, err := file.Open()
		if err != nil {
			return ""
		}
		defer part.Close()
		return paragraphs(io.LimitReader(part, docxTextMaxBytes))
	}
	return ""
}

// paragraphs reads WordprocessingML: text runs (w:t), tabs, line breaks and
// paragraph ends; everything else is skipped.
func paragraphs(document io.Reader) string {
	decoder := xml.NewDecoder(document)
	var text strings.Builder
	inText := false
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch t := token.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "t":
				inText = true
			case "tab":
				text.WriteByte('\t')
			case "br":
				text.WriteByte('\n')
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "t":
				inText = false
			case "p":
				text.WriteByte('\n')
			}
		case xml.CharData:
			if inText {
				text.Write(t)
			}
		}
	}
	return tidy(text.String())
}

// tidy keeps line breaks and tabs, drops other control characters, and
// turns runs of blank lines into one.
func tidy(text string) string {
	clean := strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, text)
	var lines []string
	blank := false
	for _, line := range strings.Split(clean, "\n") {
		line = strings.TrimRight(line, " \t")
		if line == "" {
			if !blank && len(lines) > 0 {
				lines = append(lines, "")
			}
			blank = true
			continue
		}
		blank = false
		lines = append(lines, line)
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}
