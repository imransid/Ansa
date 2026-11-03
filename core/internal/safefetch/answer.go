package safefetch

import (
	"io"
	"mime"
	"net/http"
	"strings"

	"golang.org/x/text/encoding/htmlindex"
)

// Reading a final answer, apart from fetch.go (the ~200-line rule).

// readAnswer takes a final answer's text: 2xx, text/html or text/plain, not
// compressed, at most 2 MB (reading stops there), decoded with the charset
// its server names, else UTF-8.
func readAnswer(response *http.Response) (Page, string) {
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return Page{}, "http_status"
	}
	mediaType, parameters, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	mediaType = strings.ToLower(mediaType)
	if mediaType != "text/html" && mediaType != "text/plain" {
		return Page{}, "wrong_type"
	}
	if encoding := strings.ToLower(strings.TrimSpace(response.Header.Get("Content-Encoding"))); encoding != "" && encoding != "identity" {
		return Page{}, "unsupported_encoding"
	}
	if response.ContentLength > maxBytes {
		return Page{}, "too_large"
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	switch {
	case err != nil:
		return Page{}, "network_error"
	case len(data) > maxBytes:
		return Page{}, "too_large"
	}
	return Page{ContentType: mediaType, Text: decode(data, parameters["charset"])}, ""
}

func decode(data []byte, charset string) string {
	if charset != "" {
		if encoding, err := htmlindex.Get(charset); err == nil {
			if text, err := encoding.NewDecoder().Bytes(data); err == nil {
				return string(text)
			}
		}
	}
	return strings.ToValidUTF8(string(data), "�")
}
