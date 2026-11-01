# contentrules (core/internal/contentrules)

**What:** what a post may say and how long it may be (the old
`lib/content-rules.ts`, `lib/content-studio/words-to-avoid.ts`). Today:
Facebook's rules, the ones "Post for me" and the publishing queue check;
LinkedIn's, X's and YouTube's move with the content studio.
**Rules:**
- The published text is the body, the call to action and the hashtags
  ("#tag" each), each its own paragraph; Facebook takes 63,206 characters of
  it and at most 10 hashtags.
- "Words to avoid" (the owner's confirmed fact): split at line breaks,
  commas and semicolons; each piece without its list marker, quotes and end
  punctuation; 2-100 characters; at most 100; "None." (and the like, English
  only) lists nothing. A post using one as a whole word or phrase, in any
  case ("cheap" finds "Cheap!" and "#cheap", never "cheapest"), is blocked.
  Go has no look-behind: the boundaries around each match are checked by hand.
**Tests:** `contentrules_test.go`.
