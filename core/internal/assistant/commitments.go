package assistant

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"ansa/core/internal/money"
)

// ReasonNeedsDecision: a person's reply would commit them, so ansa sends
// their holding reply and keeps a note for them instead.
const ReasonNeedsDecision = "needs_decision"

// For one person ansa never commits them to a meeting, a time or a
// decision (step 50): the prompt says so, and this check holds it. A
// person's reply that names a clock time, a day or an agreement ("see you",
// "booked") goes only when their own texts (what they do, their
// instructions, their saved answers) name it too, in English or Bangla,
// written either way ("3 pm" is "15:00", "আগামীকাল" is "tomorrow"). It reads
// words, not meaning, and errs toward the person: "I'll tell Rafa you asked
// about tomorrow" stops as well, and the holding reply goes instead.

// Clock times: the hour in group 1, the minutes (maybe none) in group 2.
var (
	// "3 pm", "3pm", "3:30 p.m.", "11.15am": am or pm in group 3.
	twelveHourTime = regexp.MustCompile(`(?i)\b(\d{1,2})(?:[:.]([0-5]\d))?\s?([ap])\.?\s?m\b`)
	clockTimes     = []*regexp.Regexp{
		// "15:00", "9:30".
		regexp.MustCompile(`\b([01]?\d|2[0-3]):([0-5]\d)\b`),
		// "4 o'clock".
		regexp.MustCompile(`(?i)\b(\d{1,2})(?:[:.]([0-5]\d))?\s?o['’]?\s?clock\b`),
		// Bangla "৩টায়" (at 3), its য় written either way Unicode allows.
		regexp.MustCompile(`(\d{1,2})(?:[:.]([0-5]\d))?\s?টা(?:\x{09DF}|\x{09AF}\x{09BC})`),
		// Bangla "বিকেল ৩টা" (3 in the afternoon): a part of the day, then the hour.
		regexp.MustCompile(`(?:সকাল|দুপুর|বিকাল|বিকেল|সন্ধ্যা|রাত)[\p{L}\p{M}]*\s*(\d{1,2})(?:[:.]([0-5]\d))?\s?টা`),
	}
)

var (
	englishDay       = regexp.MustCompile(`(?i)\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b`)
	englishAgreement = regexp.MustCompile(`(?i)\b(?:confirmed|booked|see you|agreed|it['’]?s a deal|it is a deal)\b`)
	// A Bangla day as a whole word with the endings it takes ("আজকে",
	// "কালকের", "সোমবারে"): never "সকাল" (morning), "কালো" (black) or "আজব" (strange).
	banglaDayWord = regexp.MustCompile(`^(আজ|আগামীকাল|কাল|পরশু|রবিবার|রোববার|সোমবার|মঙ্গলবার|বুধবার|বৃহস্পতিবার|বিষ্যুদবার|শুক্রবার|শনিবার)[কেরইও]{0,3}$`)
	// Each Bangla day as English says it, so either language allows the other.
	banglaDayNames = map[string]string{
		"আজ": "today", "আগামীকাল": "tomorrow", "কাল": "tomorrow", "পরশু": "the day after tomorrow",
		"রবিবার": "sunday", "রোববার": "sunday", "সোমবার": "monday", "মঙ্গলবার": "tuesday", "বুধবার": "wednesday",
		"বৃহস্পতিবার": "thursday", "বিষ্যুদবার": "thursday", "শুক্রবার": "friday", "শনিবার": "saturday",
	}
)

// commitmentsAreKnown: every clock time, day and agreement the reply names,
// the person's own texts name too.
func commitmentsAreKnown(text string, ownerTexts []string) bool {
	known := map[string]bool{}
	for _, owner := range ownerTexts {
		for _, meanings := range commitmentsIn(owner) {
			for _, meaning := range meanings {
				known[meaning] = true
			}
		}
	}
	for _, meanings := range commitmentsIn(text) {
		if !anyKnown(meanings, known) {
			return false
		}
	}
	return true
}

// anyKnown: the person's texts name one of the things a time, a day or an agreement may mean.
func anyKnown(meanings []string, known map[string]bool) bool {
	for _, meaning := range meanings {
		if known[meaning] {
			return true
		}
	}
	return false
}

// commitmentsIn lists the clock times, days and agreements a text names,
// each as what it may mean ("4 o'clock" may be "time 04:00" or "time 16:00").
func commitmentsIn(text string) [][]string {
	text = money.WithASCIIDigits(text)
	found := clockTimesIn(text)
	for _, match := range englishDay.FindAllStringSubmatch(text, -1) {
		found = append(found, []string{"day " + strings.ToLower(match[1])})
	}
	for _, match := range englishAgreement.FindAllString(text, -1) {
		found = append(found, []string{"agreement " + englishAgreementKey(match)})
	}
	words := strings.FieldsFunc(text, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsMark(r) })
	for i, word := range words {
		if match := banglaDayWord.FindStringSubmatch(word); match != nil {
			found = append(found, []string{"day " + banglaDayNames[match[1]]})
		}
		next := ""
		if i+1 < len(words) {
			next = words[i+1]
		}
		if agreement := banglaAgreement(word, next); agreement != "" {
			found = append(found, []string{"agreement " + agreement})
		}
	}
	return found
}

// clockTimesIn lists the clock times a text names. A time with am or pm is
// read once ("3:30 pm" is not also "3:30").
func clockTimesIn(text string) [][]string {
	var times [][]string
	for _, match := range twelveHourTime.FindAllStringSubmatch(text, -1) {
		times = append(times, timesOfDay(match[1], match[2], strings.ToLower(match[3])))
	}
	rest := twelveHourTime.ReplaceAllString(text, " ")
	for _, pattern := range clockTimes {
		for _, match := range pattern.FindAllStringSubmatch(rest, -1) {
			times = append(times, timesOfDay(match[1], match[2], ""))
		}
	}
	return times
}

// timesOfDay is what an hour and its minutes may mean: half "a" or "p" (am,
// pm) says which half of the day; without it an hour from 1 to 12 may be
// either. The patterns hold digits only, and no minutes is 0.
func timesOfDay(hourText, minuteText, half string) []string {
	hour, _ := strconv.Atoi(hourText)
	minute, _ := strconv.Atoi(minuteText)
	hours := []int{hour % 24}
	switch {
	case half == "a":
		hours = []int{hour % 12}
	case half == "p":
		hours = []int{hour%12 + 12}
	case hour >= 1 && hour <= 12:
		hours = []int{hour % 12, hour%12 + 12}
	}
	meanings := make([]string, 0, len(hours))
	for _, h := range hours {
		meanings = append(meanings, fmt.Sprintf("time %02d:%02d", h, minute))
	}
	return meanings
}

// englishAgreementKey: "It’s a deal", "its a deal" and "it is a deal" are one.
func englishAgreementKey(match string) string {
	lower := strings.ToLower(match)
	if strings.HasSuffix(lower, "deal") {
		return "it's a deal"
	}
	return lower
}

// banglaAgreement is the agreement a Bangla word (with the word after it)
// makes, as English says it, or "": confirmed, booked, agreed (রাজি, never
// the name রাজিব) and "দেখা হবে" (we'll meet).
func banglaAgreement(word, next string) string {
	switch {
	case strings.HasPrefix(word, "কনফার্ম"):
		return "confirmed"
	case strings.HasPrefix(word, "বুকিং"), word == "বুক" && strings.HasPrefix(next, "কর"):
		return "booked"
	case word == "রাজি", word == "রাজী", word == "রাজিও":
		return "agreed"
	case word == "দেখা" && strings.HasPrefix(next, "হবে"):
		return "see you"
	}
	return ""
}
