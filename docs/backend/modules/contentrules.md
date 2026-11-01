# contentrules (core/internal/contentrules)

**What:** what a post may say and how long it may be, on every platform
ansa posts to (the old `lib/content-rules.ts`, `lib/social-platforms.ts`
and `lib/content-studio/` text-measure, x-length, hashtags, draft-text and
words-to-avoid). Pure: no database. The content studio's approvals, the
publishing queue's checks before sending, and "Post for me" read it. The
browser's live counts keep their own copy in `lib/content-rules.ts`; the
two must agree (the vectors below prove it).

**Platforms (`platforms.go`):** LinkedIn (3,000 characters), Facebook
(63,206 characters), X (280 as X counts them), YouTube (videos only: a
title of 1-100 characters and a description of 5,000 BYTES, no "<" or ">");
at most 10 hashtags (X warns above 2). What ansa publishes to each
(`PublishedFormats`: videos to YouTube only), the platforms that revoke on
a Disconnect (X, Google), the stand-in's account id.

**Counting (`measure.go`):** every text in its composed form (NFC, as
JavaScript makes it: Go's own NFC adds a U+034F after 30 marks in a row,
which is taken out). Characters = code points; bytes = UTF-8; X =
twitter-text's weights (1 for the scripts X counts as one, else 2; an emoji
2 however many code points make it; a link, found anywhere as http://,
https:// or www., 23). Graphemes are cut close to UAX #29 where it matters
for counting (marks, variation selectors, skin tones, tags, joined emoji,
flags); the emoji test is Unicode's Extended_Pictographic table
(`pictographic.go`, made from the same Unicode data the browser uses).
APPROXIMATED as the old code was: a bare "example.com" counts letter by
letter (X shortens it), a keycap may count a little differently.

**Checks (`issues.go`, `CheckDraft`):** in the order a person fixes them,
each blocking or a warning, worded exactly as the old pages: a format the
platform doesn't take; an image post without its image or a video without
its video; a missing or long title; a text post without text; a text too
long (call to action and hashtags included); angle brackets on YouTube; too
many hashtags; every word to avoid it uses, saying where (the title, the
text, the video script, the media's alt text, published with it).
`FacebookProblems` stays for "Post for me" (Facebook text posts).

**Texts (`drafttext.go`, `hashtags.go`):** at most 30 combining marks in a
row (Unicode's stream-safe bound: a person's longer run is refused, the
AI's cut; normalizing a long run takes time growing with its square); one
line as saved (line breaks to spaces, hidden format characters out but the
joiners and tag characters writing needs); several lines as `\n`.
Hashtags: letters, marks, digits and "_", not digits alone, at most 60; a
typed box is read word by word, each once; the AI's are cleaned, at most 30.

**"Words to avoid":** the owner's confirmed fact, split at line breaks,
commas and semicolons; each piece without its list marker, quotes and end
punctuation; 2-100 characters; at most 100; "None." (English) lists
nothing. Matched as whole words or phrases in any case ("cheap" finds
"Cheap!" and "#cheap", never "cheapest").

**Tests:** `contentrules_test.go`; `oldrules_test.go` reads
`testdata/old_rules.json`, made by running the OLD TypeScript rules on the
same inputs (counts in all three ways, cleaning, hashtags, every issue
word for word): the Go port must give the same answers.
