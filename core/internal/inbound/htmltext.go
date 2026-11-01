package inbound

import (
	"html"
	"regexp"
	"strings"
)

// Elements whose content no person reads ("head" is not one: its closing
// tag is often left out, and skipping to it would skip the whole email).
var skipped = map[string]bool{"script": true, "style": true, "title": true, "template": true, "noscript": true, "svg": true}

// Elements that start or end a line.
var lineBreaking = map[string]bool{"br": true, "p": true, "div": true, "li": true, "tr": true, "table": true, "ul": true, "ol": true, "hr": true,
	"pre": true, "blockquote": true, "h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true, "section": true, "article": true,
	"header": true, "footer": true, "dl": true, "dt": true, "dd": true, "caption": true, "center": true, "address": true, "figure": true,
	"figcaption": true, "form": true, "fieldset": true, "legend": true, "main": true, "nav": true, "aside": true}

var tagName = regexp.MustCompile(`^[a-z][a-z0-9]*`)
var spaces = regexp.MustCompile(`\s+`)

// HTMLToText is the plain text of an email's HTML part (the old
// lib/html-to-text.ts), for emails without a plain-text part. A small
// scanner that only moves forward, so even hostile HTML takes time in
// proportion to its length; it stops past maxCharacters. Shown as text, never as HTML.
func HTMLToText(document string, maxCharacters int) string {
	var out strings.Builder
	position := 0
	for position < len(document) && out.Len() <= maxCharacters {
		start := strings.IndexByte(document[position:], '<')
		end := len(document)
		if start >= 0 {
			end = position + start
		}
		out.WriteString(spaces.ReplaceAllString(html.UnescapeString(document[position:end]), " "))
		if start < 0 {
			break
		}
		position = skipTag(document, end, &out)
	}
	return tidyLines(out.String())
}

// skipTag moves past the tag (or comment) at start, adding a line break or a
// cell's tab where the element makes one.
func skipTag(document string, start int, out *strings.Builder) int {
	if strings.HasPrefix(document[start:], "<!--") {
		if end := strings.Index(document[start+4:], "-->"); end >= 0 {
			return start + 4 + end + 3
		}
		return len(document)
	}
	end := strings.IndexByte(document[start+1:], '>')
	if end < 0 {
		return len(document)
	}
	end += start + 1
	closing := start+1 < len(document) && document[start+1] == '/'
	content := document[start+1 : end]
	if closing {
		content = content[1:]
	}
	if len(content) > 30 {
		content = content[:30]
	}
	name := tagName.FindString(strings.ToLower(content))
	switch {
	case skipped[name] && !closing:
		closingTag := strings.Index(strings.ToLower(document[end+1:]), "</"+name)
		if closingTag < 0 {
			return len(document)
		}
		after := strings.IndexByte(document[end+1+closingTag:], '>')
		if after < 0 {
			return len(document)
		}
		return end + 1 + closingTag + after + 1
	case lineBreaking[name]:
		out.WriteByte('\n')
	case (name == "td" || name == "th") && !closing:
		out.WriteByte('\t')
	}
	return end + 1
}

// tidyLines: one space between words, one tab between cells, nothing at the
// ends, at most one empty line in a row.
func tidyLines(text string) string {
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		cells := strings.Split(line, "\t")
		for j, cell := range cells {
			cells[j] = strings.TrimSpace(spaces.ReplaceAllString(cell, " "))
		}
		lines[i] = strings.TrimSpace(strings.Join(cells, "\t"))
	}
	joined := strings.Join(lines, "\n")
	for strings.Contains(joined, "\n\n\n") {
		joined = strings.ReplaceAll(joined, "\n\n\n", "\n\n")
	}
	return strings.TrimSpace(joined)
}
