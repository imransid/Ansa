package analytics

import (
	"math"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// The numbers written in a review's texts (the old
// lib/performance-review/text-numbers.ts): a finding may write only the
// numbers it cites, so an invented one ("40% more", "1.2k views") can't
// hide in its words. Read the way the old regular expressions read them,
// by hand (Go's regular expressions have no look-behind).

// numbersWrittenIn is every number written in a text, as written, times of
// day ("09:00", "9:30": the prompt asks for times so) left out. NFKC first
// turns full-width digits (４０) and the like into 0-9. A number is digits
// of any script (Persian ۴۰, Devanagari ४०) with "." or "," between groups
// ("1,234", "6.5"), not right after a letter, a digit or "_" (a label
// such as P3 or a word like H2 is no number); one followed by letters
// still is ("3x", "1.2k", "2nd").
func numbersWrittenIn(text string) []string {
	runes := withoutTimesOfDay([]rune(norm.NFKC.String(text)))
	var numbers []string
	for index := 0; index < len(runes); {
		if !unicode.IsDigit(runes[index]) || (index > 0 && isWordCharacter(runes[index-1])) {
			index++
			continue
		}
		end := afterDigits(runes, index)
		for end+1 < len(runes) && (runes[end] == '.' || runes[end] == ',') && unicode.IsDigit(runes[end+1]) {
			end = afterDigits(runes, end+1)
		}
		numbers = append(numbers, string(runes[index:end]))
		index = end
	}
	return numbers
}

// withoutTimesOfDay puts a space where a time of day is: hours 0-23 (one
// or two digits 0-9), ":" and minutes, with no number character right
// before or after it.
func withoutTimesOfDay(runes []rune) []rune {
	out := make([]rune, 0, len(runes))
	for index := 0; index < len(runes); {
		if length := timeOfDayAt(runes, index); length > 0 {
			out = append(out, ' ')
			index += length
			continue
		}
		out = append(out, runes[index])
		index++
	}
	return out
}

// timeOfDayAt is the length of the time of day starting at index, or 0.
// The forms are tried in the old pattern's order: [01]\d:mm, \d:mm, 2[0-3]:mm.
func timeOfDayAt(runes []rune, index int) int {
	if index > 0 && unicode.IsNumber(runes[index-1]) {
		return 0
	}
	at := func(offset int) rune {
		if index+offset < len(runes) {
			return runes[index+offset]
		}
		return 0
	}
	endsThere := func(length int) bool {
		return at(length-3) == ':' && between(at(length-2), '0', '5') && between(at(length-1), '0', '9') &&
			(index+length >= len(runes) || !unicode.IsNumber(runes[index+length]))
	}
	if between(at(0), '0', '1') && between(at(1), '0', '9') && endsThere(5) {
		return 5
	}
	if between(at(0), '0', '9') && endsThere(4) {
		return 4
	}
	if at(0) == '2' && between(at(1), '0', '3') && endsThere(5) {
		return 5
	}
	return 0
}

func between(r, low, high rune) bool { return r >= low && r <= high }

func afterDigits(runes []rune, index int) int {
	for index < len(runes) && unicode.IsDigit(runes[index]) {
		index++
	}
	return index
}

func isWordCharacter(r rune) bool { return unicode.IsLetter(r) || unicode.IsNumber(r) || r == '_' }

// writingsOf is the ways a cited number may be written: 1234 as "1234",
// "1,234" or "1.234"; 6.5 as "6.5" or "6,5". Only in 0-9 (the prompt asks
// for them): a cited value written in other digits counts as a number not cited.
func writingsOf(value float64) []string {
	if math.IsInf(value, 0) || math.IsNaN(value) {
		return nil
	}
	plain := strconv.FormatFloat(value, 'f', -1, 64)
	if value != math.Trunc(value) {
		return []string{plain, strings.Replace(plain, ".", ",", 1)}
	}
	grouped := groupThousands(plain)
	return []string{plain, grouped, strings.ReplaceAll(grouped, ",", ".")}
}

// groupThousands puts "," between groups of three digits ("-1234" -> "-1,234").
func groupThousands(digits string) string {
	sign := ""
	if strings.HasPrefix(digits, "-") {
		sign, digits = "-", digits[1:]
	}
	var out strings.Builder
	for index, digit := range digits {
		if index > 0 && (len(digits)-index)%3 == 0 {
			out.WriteByte(',')
		}
		out.WriteRune(digit)
	}
	return sign + out.String()
}

// writesOnlyAllowedNumbers: whether every number written in the text is one
// of allowed (written in one of its ways), or appears in one of names (a
// topic or pillar name quoted: "Top 5 breads" holds a 5 that is no result,
// in whatever digits).
func writesOnlyAllowedNumbers(text string, allowed []float64, names []string) bool {
	accepted := map[string]bool{}
	for _, value := range allowed {
		for _, writing := range writingsOf(value) {
			accepted[writing] = true
		}
	}
	for _, name := range names {
		for _, written := range numbersWrittenIn(name) {
			accepted[written] = true
		}
	}
	for _, written := range numbersWrittenIn(text) {
		if !accepted[written] {
			return false
		}
	}
	return true
}
