// Package menureading is "Read my menu" (the old services/menu-reading.ts):
// a photo, a PDF, a Word file or pasted text read by the AI into a list of
// dishes for the owner to check. NOTHING is saved here: the list goes back
// to the page, and only "Looks right" adds the dishes (menu.Add), checked
// again. A photo or a PDF goes to the model as itself (no parser runs on
// our servers); a Word file's text is unpacked here under a hard cap. Every
// price is read by core's own rules (money.ParsePrice), never the AI's.
package menureading

import (
	"context"
	"encoding/base64"
	"strings"
	"unicode/utf8"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/menu"
	"ansa/core/internal/plaintext"
)

// Source is what the owner gave: a file (its bytes and name) or pasted text.
type Source struct {
	File     []byte
	FileName string
	Text     string
}

// Result is the dishes read, how many rows were left out, and whether it is
// the development sample (no AI key).
type Result struct {
	Items   []menu.Fields `json:"items"`
	Dropped int           `json:"dropped"`
	StandIn bool          `json:"standIn"`
}

// What went wrong, in words for people.
const (
	WrongFile    = "Upload a photo (JPEG, PNG or WebP), a PDF or a Word file of your menu."
	TooBig       = "This file is over 4 MB. Upload a smaller photo, or paste the text."
	NoText       = "No text could be read from this file. Upload a photo of the menu instead."
	NothingGiven = "Upload a photo or a file of your menu, or paste its text."
	Unreadable   = "ansa couldn't read this menu. Try again, with a sharper photo, or paste the text."
	NoDishes     = "No dishes with prices were found. Try a sharper photo of the page with the prices, or paste the text."
	Unavailable  = "Reading a menu with the AI isn't available yet. Add your dishes by hand on the Menu page."
)

type brainFile struct {
	MediaType string `json:"media_type"`
	Data      string `json:"data"`
}

type brainRequest struct {
	Currency string     `json:"currency"`
	File     *brainFile `json:"file"`
	Text     *string    `json:"text"`
}

type brainAnswer struct {
	Kind   string       `json:"kind"`
	Reason string       `json:"reason"`
	Rows   []menu.Typed `json:"rows"`
}

// request is what the brain is sent, or the words saying why nothing can be.
func request(source Source, currency string) (brainRequest, string) {
	r := brainRequest{Currency: currency}
	if len(source.File) > 0 {
		if len(source.File) > FileMaxBytes {
			return r, TooBig
		}
		switch kind := MediaType(source.File); {
		case kind == "application/zip" && strings.HasSuffix(strings.ToLower(source.FileName), ".docx"):
			text := DocxText(source.File)
			if text == "" {
				return r, NoText
			}
			r.Text = &text
		case kind == "" || kind == "application/zip":
			return r, WrongFile
		default:
			r.File = &brainFile{MediaType: kind, Data: base64.StdEncoding.EncodeToString(source.File)}
		}
		return r, ""
	}
	text, problem := plaintext.Note(source.Text, 20_000)
	if problem != "" {
		return r, strings.Replace(problem, "At most 20,000 characters.", "Paste at most 20,000 characters at a time.", 1)
	}
	if text == "" {
		return r, NothingGiven
	}
	r.Text = &text
	return r, ""
}

// Read reads the menu into dishes priced in the currency, or says why not.
func Read(ctx context.Context, brain *brainclient.Client, source Source, currency string) (Result, string) {
	req, problem := request(source, currency)
	if problem != "" {
		return Result{}, problem
	}
	var answer brainAnswer
	if err := brain.Call(ctx, "/v1/menu/read", req, &answer); err != nil {
		return Result{}, Unreadable
	}
	switch answer.Kind {
	case "ok", "stand_in":
	case "failed":
		if answer.Reason == "model_unavailable" {
			return Result{}, Unavailable
		}
		return Result{}, Unreadable
	default:
		return Result{}, Unreadable
	}
	result := Result{Items: []menu.Fields{}, StandIn: answer.Kind == "stand_in"}
	for _, row := range answer.Rows {
		item, problems := cutToLimits(row).Check(currency)
		if len(problems) > 0 || len(result.Items) >= menu.ItemsPerReadingMax {
			result.Dropped++
			continue
		}
		result.Items = append(result.Items, item)
	}
	if len(result.Items) == 0 {
		return Result{}, NoDishes
	}
	return result, ""
}

// cutToLimits cuts a row's texts to the menu's limits, as one plain line
// each: the AI's long text is cut, never refused (the owner checks it). A
// row then fails only without a name or a price core can read.
func cutToLimits(row menu.Typed) menu.Typed {
	row.Category = cutRunes(plaintext.SingleLine(row.Category), 60)
	row.Name = cutRunes(plaintext.SingleLine(row.Name), 120)
	row.Description = cutRunes(plaintext.SingleLine(row.Description), 500)
	return row
}

func cutRunes(text string, max int) string {
	if utf8.RuneCountInString(text) <= max {
		return text
	}
	return strings.TrimSpace(string([]rune(text)[:max]))
}
