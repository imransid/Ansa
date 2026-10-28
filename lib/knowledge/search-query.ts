// Turns what someone asked ("How long do refunds take?") into the full-text
// query db/knowledge-search.ts hands to Postgres (step 34), and several
// texts into one search that gives each its share of the words (step 37).
// Pure.
//
// Postgres's to_tsquery reads operators (& | ! : * ( ) < >) and quotes, so
// a customer's words could break or bend the query. Every word here is a run
// of letters (with their accents and vowel signs) and digits only, so none of
// that can get through. The query still goes to Postgres as a parameter,
// never as SQL text.

// The most words one query keeps: a long question (or thousands of words
// pasted in) can't make Postgres do more work.
const MAX_QUERY_WORDS = 20;

// A longer "word" is no word anyone searches for, and Postgres ignores words
// over 2,047 bytes anyway.
const MAX_WORD_LENGTH = 100;

// Words this long or longer also match longer words that start with them:
// "refund" finds "refunds" and "refunded". Shorter ones would match too much.
const PREFIX_MATCH_FROM_LENGTH = 4;

// Words that say nothing about what is asked. The 'simple' search
// configuration (step 34: every language, no stemming) has no stop words of
// its own, so without this "how do I" would match every article. English
// only, and short on purpose: other words still count.
const STOP_WORDS = new Set([
  "an", "and", "are", "as", "at", "be", "but", "by", "can", "could", "did", "do", "does", "for", "from",
  "had", "has", "have", "he", "hello", "her", "hi", "his", "how", "if", "in", "is", "it", "its", "me",
  "my", "no", "not", "of", "on", "or", "our", "please", "she", "so", "thank", "thanks", "that", "the",
  "their", "them", "then", "there", "they", "this", "to", "us", "was", "we", "were", "what", "when",
  "where", "which", "who", "why", "will", "with", "would", "you", "your",
]);

// The query for to_tsquery('simple', ...): the words, lower-cased and in
// their NFKC form (so a "ﬁ" ligature or a full-width letter matches what the
// index holds), each at most once, OR-ed together ("refund:* | days"), so an
// article that matches more of them ranks higher. Null when no word is left:
// then no search runs at all.
export function buildKnowledgeTsQuery(text: string): string | null {
  const words = findSearchWords(text);
  if (words.length === 0) {
    return null;
  }
  return words.map((word) => ([...word].length >= PREFIX_MATCH_FROM_LENGTH ? `${word}:*` : word)).join(" | ");
}

// Several texts searched as one (a marketing plan's products, services and
// goals facts, step 37): their words taken in turns, the first word of each
// text, then the second of each, and so on, so one long text can't take all
// MAX_QUERY_WORDS and leave the others out. Turns a short text doesn't need
// go to the others. Gives back search text for buildKnowledgeTsQuery (and
// so for searchKnowledge): the words, each once, with spaces between.
export function combineSearchTexts(texts: string[]): string {
  const wordsOfEachText = texts.map(findSearchWords);
  const inTurns = new Set<string>();
  for (let position = 0; position < MAX_QUERY_WORDS; position++) {
    for (const words of wordsOfEachText) {
      if (position < words.length) {
        inTurns.add(words[position]);
      }
    }
  }
  return [...inTurns].slice(0, MAX_QUERY_WORDS).join(" ");
}

// The words a search keeps of a text, in their order, each once, at most
// MAX_QUERY_WORDS of them.
function findSearchWords(text: string): string[] {
  const words = new Set<string>();
  for (const match of text.normalize("NFKC").toLowerCase().matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
    const word = match[0];
    const length = [...word].length;
    if (length < 2 || length > MAX_WORD_LENGTH || STOP_WORDS.has(word)) {
      continue;
    }
    words.add(word);
    if (words.size === MAX_QUERY_WORDS) {
      break;
    }
  }
  return [...words];
}
