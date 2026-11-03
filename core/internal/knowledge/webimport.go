package knowledge

import (
	"context"
	"net/url"
	"strings"
	"unicode/utf8"

	"ansa/core/internal/database"
	"ansa/core/internal/inbound"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/safefetch"
	"ansa/core/internal/tenant"
)

// FetchProblems are the words the page shows for each fetch problem.
var FetchProblems = map[string]string{
	"invalid_url":          "That isn't a web address.",
	"address_too_long":     "That address is too long: written out in full, it has over 2,000 characters.",
	"not_https":            "Only https:// addresses can be imported.",
	"port_not_allowed":     "Only addresses without a port number can be imported.",
	"credentials_in_url":   "Remove the user name and password from the address.",
	"private_address":      "That address leads to a private network, so it can't be imported.",
	"dns_failed":           "No website answers at that address. Check it for typos.",
	"too_many_redirects":   "The page sent us on to other addresses too many times.",
	"bad_redirect":         "The page sent us on to an address that can't be used.",
	"http_status":          "The website answered with an error instead of the page.",
	"wrong_type":           "That address isn't a web page: only HTML and plain-text pages can be imported.",
	"unsupported_encoding": "That website sent the page in a form we can't read.",
	"too_large":            "That page is over 2 MB, too big to import.",
	"timeout":              "The website took more than 10 seconds to send the page.",
	"network_error":        "The website could not be reached.",
}

// The <title> is looked for in a page's first 100,000 characters only; a
// page's address is kept up to 2,000 characters (the column's CHECK).
const (
	titleSearchLength = 100_000
	addressMax        = 2_000
)

// ImportWebPage fetches one public web page (only through [safefetch]) and
// saves its text as draft articles of kind "website" with the page as their
// source (owners only, checked again when saved). fetchCode: why the page
// couldn't be fetched (the API shows FetchProblems; the log names the code,
// never the address).
func ImportWebPage(ctx context.Context, pool *database.Pool, fetcher *safefetch.Fetcher, company tenant.CompanyID, actorUserID, typed string) (created int, wasCut bool, fetchCode, problem string, err error) {
	address, code := normalizedAddress(typed)
	if code != "" {
		return 0, false, code, "", nil
	}
	page, code := fetcher.Fetch(ctx, address.String())
	if code != "" {
		return 0, false, code, "", nil
	}
	isHTML := page.ContentType == "text/html"
	text := page.Text
	if isHTML {
		text = inbound.HTMLToText(text, importedMax+1)
	}
	text = NormalizeExtracted(text)
	if text == "" {
		return 0, false, "", "No text could be read from this page.", nil
	}
	name := ""
	if isHTML {
		name = titleOf(page.Text)
	}
	if name == "" {
		name = nameFromAddress(address)
	}
	created, wasCut, problem, err = SaveImported(ctx, pool, company, actorUserID, text, name, "website", Source{URL: address.String()})
	return created, wasCut, "", problem, err
}

// normalizedAddress reads the typed address once: the page is fetched,
// named and saved under what it gives. Go writes the scheme in small
// letters ("Https://" typed is "https://", which the column's CHECK asks
// for) and escapes what an address can't hold as typed ("ü" is "%C3%BC"),
// which can make it longer, so it is measured again.
func normalizedAddress(typed string) (*url.URL, string) {
	address, err := url.Parse(typed)
	if err != nil {
		return nil, "invalid_url"
	}
	if utf8.RuneCountInString(address.String()) > addressMax {
		return nil, "address_too_long"
	}
	return address, ""
}

// titleOf is the page's <title> as one plain line, or "". Plain index
// searches (no regular expression: a page full of unclosed tags can't make
// it slow), only A-Z lower-cased so positions stay put.
func titleOf(html string) string {
	start := html
	if len(start) > titleSearchLength {
		start = start[:titleSearchLength]
	}
	lowered := []byte(start)
	for i, b := range lowered {
		if b >= 'A' && b <= 'Z' {
			lowered[i] = b + 32
		}
	}
	tag := strings.Index(string(lowered), "<title")
	if tag < 0 {
		return ""
	}
	open := strings.Index(string(lowered[tag:]), ">")
	if open < 0 {
		return ""
	}
	contentStart := tag + open + 1
	end := strings.Index(string(lowered[contentStart:]), "</title")
	if end < 0 {
		return ""
	}
	return plaintext.SingleLine(inbound.HTMLToText(start[contentStart:contentStart+end], 300))
}

// nameFromAddress is "example.com/help/returns" for a page without a title.
func nameFromAddress(address *url.URL) string {
	if address.Path == "" || address.Path == "/" {
		return address.Hostname()
	}
	return address.Hostname() + address.Path
}
