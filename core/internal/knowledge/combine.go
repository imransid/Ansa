package knowledge

import (
	"strings"
	"unicode/utf8"
)

// CombineSearchTexts searches several texts as one (a marketing plan's
// products, services and goals facts): their words taken in turns, the
// first word of each text, then the second of each, and so on, so one long
// text can't take all 20 words and leave the others out. Turns a short
// text doesn't need go to the others. Gives back search text for Search:
// the words, each once, with spaces between (the old combineSearchTexts).
func CombineSearchTexts(texts []string) string {
	wordsOfEachText := make([][]string, 0, len(texts))
	for _, text := range texts {
		wordsOfEachText = append(wordsOfEachText, searchWords(text))
	}
	var inTurns []string
	seen := map[string]bool{}
	for position := range maxQueryWords {
		for _, words := range wordsOfEachText {
			if position < len(words) && !seen[words[position]] {
				seen[words[position]] = true
				inTurns = append(inTurns, words[position])
			}
		}
	}
	if len(inTurns) > maxQueryWords {
		inTurns = inTurns[:maxQueryWords]
	}
	return strings.Join(inTurns, " ")
}

// searchWords are the words a search keeps of one text, in their order,
// each once, at most 20 (as BuildTsQuery reads them).
func searchWords(text string) []string {
	var words []string
	seen := map[string]bool{}
	for _, word := range wordPattern.FindAllString(searchForm(text), -1) {
		length := utf8.RuneCountInString(word)
		if length < 2 || length > maxWordLength || stopWords[word] || seen[word] {
			continue
		}
		seen[word] = true
		words = append(words, word)
		if len(words) == maxQueryWords {
			break
		}
	}
	return words
}
