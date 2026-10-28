// The numbers written in a review's texts (step 42): a finding may write
// only the numbers it cites, so an invented one ("40% more", "1.2k views")
// can't hide in its words. Pure.

// A time of day ("09:00", "9:30"): the prompt asks for times so; they are
// not numbers about results.
const TIME_OF_DAY = /(?<![\p{N}])([01]?\d|2[0-3]):[0-5]\d(?![\p{N}])/gu;

// A number as written: digits with "." or "," between groups ("1,234",
// "6.5", "6,5"), in any script's digits (Persian ۴۰, Devanagari ४०): \d
// finds 0-9 only, even with the u flag, and a review is written in the
// topics' language. Not a digit that follows a letter: a label (P3, G12) or
// a word like "H2" is no number. One followed by letters still is ("3x",
// "1.2k", "2nd").
const NUMBER = /(?<![\p{L}\p{N}_])\p{Nd}+(?:[.,]\p{Nd}+)*/gu;

// Every number written in a text, as written, times of day left out.
// NFKC first turns full-width digits (４０) and the like into 0-9.
export function numbersWrittenIn(text: string): string[] {
  return [...text.normalize("NFKC").replace(TIME_OF_DAY, " ").matchAll(NUMBER)].map((match) => match[0]);
}

// The ways a number may be written: 1234 as "1234", "1,234" or "1.234";
// 6.5 as "6.5" or "6,5". Only in 0-9 (the prompt asks for them): a cited
// value written in other digits counts as a number not cited.
export function writingsOf(value: number): string[] {
  if (!Number.isFinite(value)) {
    return [];
  }
  if (Number.isInteger(value)) {
    const plain = String(value);
    const grouped = plain.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return [plain, grouped, grouped.replaceAll(",", ".")];
  }
  const plain = String(value);
  return [plain, plain.replace(".", ",")];
}

// Whether every number written in the text is one of `allowed` (written in
// one of its ways), or appears in one of `names` (a topic or pillar name
// quoted: "Top 5 breads" holds a 5 that is no result, in whatever digits).
export function writesOnlyAllowedNumbers(text: string, allowed: number[], names: string[]): boolean {
  const accepted = new Set(allowed.flatMap(writingsOf));
  for (const name of names) {
    for (const written of numbersWrittenIn(name)) {
      accepted.add(written);
    }
  }
  return numbersWrittenIn(text).every((written) => accepted.has(written));
}
