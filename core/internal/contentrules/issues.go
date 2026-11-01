package contentrules

import (
	"strconv"
	"strings"
	"unicode/utf8"
)

// The rules a content draft must meet before an owner approves it, and
// that the queue checks again before a post goes out (the old
// checkContentRules). Blocking: never approved or sent until fixed;
// warning: worth a look.
const (
	Blocking = "blocking"
	Warning  = "warning"
)

// Issue is one problem, worded for the person who fixes it.
type Issue struct {
	Code     string `json:"code"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

// Draft is what the rules read of a content draft.
type Draft struct {
	Platform, Format, Title, Body, CallToAction, VideoScript string
	Hashtags                                                 []string
}

// Media is the image or video attached from the media library: its kind
// ("image" or "video") and its alt text, which is published with it.
type Media struct {
	Kind, AltText string
}

// CheckDraft is every problem of a draft, in the order a person fixes
// them: what it is, what it says, then the words it uses. media nil:
// nothing attached; wordsToAvoid from the confirmed fact (ReadWordsToAvoid).
func CheckDraft(d Draft, media *Media, wordsToAvoid []string) []Issue {
	rules, known := PlatformRules[d.Platform]
	if !known {
		return []Issue{{Code: "format_not_accepted", Severity: Blocking, Message: "This platform isn't one ansa posts to."}}
	}
	var issues []Issue
	issues = append(issues, formatIssues(d, rules, media)...)
	issues = append(issues, titleIssues(d, rules)...)
	issues = append(issues, textIssues(d, rules)...)
	issues = append(issues, hashtagIssues(d, rules)...)
	return append(issues, wordsToAvoidIssues(d, rules, media, wordsToAvoid)...)
}

// HasBlocking says whether any issue blocks.
func HasBlocking(issues []Issue) bool {
	for _, issue := range issues {
		if issue.Severity == Blocking {
			return true
		}
	}
	return false
}

func formatIssues(d Draft, rules Rules, media *Media) []Issue {
	platform := PlatformLabels[d.Platform]
	if !Takes(rules.Formats, d.Format) {
		message := platform + " takes " + DescribeAcceptedFormats(d.Platform) + ", not a " + strings.ToLower(FormatLabels[d.Format]) + "."
		return []Issue{{Code: "format_not_accepted", Severity: Blocking, Message: message}}
	}
	needed := map[string]string{"video": "video", "image_post": "image"}[d.Format]
	if needed != "" && (media == nil || media.Kind != needed) {
		message := "This post needs its image before it can be approved: attach one from the media library, or make one with the AI (under Media)."
		if needed == "video" {
			message = "This video needs its video before it can be approved: attach one from the media library (under Media)."
		}
		return []Issue{{Code: "media_missing", Severity: Blocking, Message: message}}
	}
	return nil
}

func titleIssues(d Draft, rules Rules) []Issue {
	if rules.TitleMax == 0 {
		return nil
	}
	platform := PlatformLabels[d.Platform]
	length := MeasureText(strings.TrimSpace(d.Title), CountingCharacters)
	switch {
	case length == 0:
		return []Issue{{Code: "title_missing", Severity: Blocking, Message: "A " + platform + " video needs a title."}}
	case length > rules.TitleMax:
		message := "The title is " + withThousands(length) + " characters. " + platform + " allows " + strconv.Itoa(rules.TitleMax) + "."
		return []Issue{{Code: "title_too_long", Severity: Blocking, Message: message}}
	}
	return nil
}

func textIssues(d Draft, rules Rules) []Issue {
	platform := PlatformLabels[d.Platform]
	text := PublishedText(Post{Body: d.Body, CallToAction: d.CallToAction, Hashtags: d.Hashtags})
	var issues []Issue
	if d.Format == "post" && strings.TrimSpace(d.Body) == "" {
		issues = append(issues, Issue{Code: "text_missing", Severity: Blocking, Message: "The post has no text yet."})
	}
	if length := MeasureText(text, rules.TextCounting); length > rules.TextMax {
		what := "The post"
		if rules.TitleMax > 0 {
			what = "The description"
		}
		bytesNote := ""
		if rules.TextCounting == CountingUTF8Bytes {
			bytesNote = " (an accented letter counts 2, an emoji 4)"
		}
		message := what + " is " + withThousands(length) + " " + countingUnits[rules.TextCounting] + ", call to action and hashtags included. " +
			platform + " allows " + withThousands(rules.TextMax) + bytesNote + "."
		issues = append(issues, Issue{Code: "text_too_long", Severity: Blocking, Message: message})
	}
	if rules.RefusesAngleBrackets && strings.ContainsAny(d.Title+text, "<>") {
		message := platform + ` refuses "<" and ">" in a title or description. Take them out.`
		issues = append(issues, Issue{Code: "angle_brackets", Severity: Blocking, Message: message})
	}
	return issues
}

func hashtagIssues(d Draft, rules Rules) []Issue {
	count := len(d.Hashtags)
	platform := PlatformLabels[d.Platform]
	if count > rules.HashtagsMax {
		message := strconv.Itoa(count) + " hashtags. " + platform + " posts take at most " + strconv.Itoa(rules.HashtagsMax) + "."
		return []Issue{{Code: "too_many_hashtags", Severity: Blocking, Message: message}}
	}
	if rules.HashtagsRecommended > 0 && count > rules.HashtagsRecommended {
		message := strconv.Itoa(count) + " hashtags. " + platform + " recommends no more than " + strconv.Itoa(rules.HashtagsRecommended) + "."
		return []Issue{{Code: "many_hashtags", Severity: Warning, Message: message}}
	}
	return nil
}

// wordsToAvoidIssues: one issue per word to avoid the draft uses, saying
// where (its texts, and its media's alt text, published with it). Each
// text is searched once for all the words.
func wordsToAvoidIssues(d Draft, rules Rules, media *Media, wordsToAvoid []string) []Issue {
	if len(wordsToAvoid) == 0 {
		return nil
	}
	type place struct {
		name  string
		found []string
	}
	places := []place{
		{"the title", FindWordsToAvoid(d.Title, wordsToAvoid)},
		{"the " + strings.ToLower(rules.TextLabel), FindWordsToAvoid(PublishedText(Post{Body: d.Body, CallToAction: d.CallToAction, Hashtags: d.Hashtags}), wordsToAvoid)},
		{"the video script", FindWordsToAvoid(d.VideoScript, wordsToAvoid)},
	}
	if media != nil {
		places = append(places, place{"the " + media.Kind + "'s alt text (media library)", FindWordsToAvoid(media.AltText, wordsToAvoid)})
	}
	var issues []Issue
	for _, word := range wordsToAvoid {
		var where []string
		for _, p := range places {
			if Takes(p.found, word) {
				where = append(where, p.name)
			}
		}
		if len(where) > 0 {
			message := `"` + word + `" is on your Words to avoid list (business profile), and this draft uses it in ` + strings.Join(where, " and ") + "."
			issues = append(issues, Issue{Code: "word_to_avoid", Severity: Blocking, Message: message})
		}
	}
	return issues
}

// withThousands is "63,207", as the old pages wrote numbers (en-US).
func withThousands(n int) string {
	digits := strconv.Itoa(n)
	if n < 0 || utf8.RuneCountInString(digits) <= 3 {
		return digits
	}
	var out strings.Builder
	for i, digit := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			out.WriteByte(',')
		}
		out.WriteRune(digit)
	}
	return out.String()
}
