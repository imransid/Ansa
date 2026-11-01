package contentrules

// The social platforms ansa plans for and publishes to (the old
// lib/social-platforms.ts and the platform table of lib/content-rules.ts),
// as docs/research/social-publishing-apis.md found them. The browser's live
// checks keep their own copy in lib/content-rules.ts: the two must agree.

// The platforms, in the order the pages list them.
var Platforms = []string{"linkedin", "facebook", "x", "youtube"}

// PlatformLabels are their names as people read them.
var PlatformLabels = map[string]string{"linkedin": "LinkedIn", "facebook": "Facebook", "x": "X", "youtube": "YouTube"}

// The formats of a draft: a text post, a post with an image, a video.
var Formats = []string{"post", "image_post", "video"}

// FormatLabels are the formats' names; formatPlurals say what a platform takes.
var FormatLabels = map[string]string{"post": "Text post", "image_post": "Post with an image", "video": "Video"}

var formatPlurals = map[string]string{"post": "text posts", "image_post": "posts with an image", "video": "videos"}

// PublishedFormats are what ansa publishes to each platform now. LinkedIn,
// Facebook and X take videos too, through upload flows ansa doesn't have
// yet; the queue refuses to schedule what isn't here.
var PublishedFormats = map[string][]string{
	"linkedin": {"post", "image_post"},
	"facebook": {"post", "image_post"},
	"x":        {"post", "image_post"},
	"youtube":  {"video"},
}

// RevokesOnRequest are the platforms that take ansa's access back when a
// Disconnect asks (X and Google); for the others the owner removes ansa on
// the platform itself.
var RevokesOnRequest = map[string]bool{"x": true, "youtube": true}

// StandInAccountID is the development stand-in's account id: no real
// platform's ids hold a ":" (a CHECK ties is_stand_in to it).
const StandInAccountID = "dev:stand-in"

// How a platform counts a text against its limit.
const (
	// X's own weighing (CountX).
	CountingX = "x"
	// Unicode characters (code points after NFC), as LinkedIn, Facebook and
	// YouTube (titles) state their limits.
	CountingCharacters = "characters"
	// Bytes, as YouTube states a description's limit.
	CountingUTF8Bytes = "utf8-bytes"
)

// countingUnits are how each count is written next to its number.
var countingUnits = map[string]string{CountingX: "characters as X counts them", CountingCharacters: "characters", CountingUTF8Bytes: "bytes"}

// Rules are what one platform takes.
type Rules struct {
	Formats []string
	// A video's title (YouTube): 0 = the platform has none.
	TitleMax int
	// The text it publishes (YouTube: the description), its limit and counting.
	TextLabel    string
	TextMax      int
	TextCounting string
	// At most HashtagsMax (blocking above); above HashtagsRecommended a warning (0 = none).
	HashtagsMax, HashtagsRecommended int
	// YouTube refuses "<" and ">" in a title or a description.
	RefusesAngleBrackets bool
}

// PlatformRules are each platform's rules.
var PlatformRules = map[string]Rules{
	"linkedin": {Formats: Formats, TextLabel: "Post text", TextMax: 3_000, TextCounting: CountingCharacters, HashtagsMax: 10},
	"facebook": {Formats: Formats, TextLabel: "Post text", TextMax: FacebookTextMax, TextCounting: CountingCharacters, HashtagsMax: FacebookHashtagsMax},
	"x":        {Formats: Formats, TextLabel: "Post text", TextMax: 280, TextCounting: CountingX, HashtagsMax: 10, HashtagsRecommended: 2},
	"youtube": {Formats: []string{"video"}, TitleMax: 100, TextLabel: "Description", TextMax: 5_000, TextCounting: CountingUTF8Bytes,
		HashtagsMax: 10, RefusesAngleBrackets: true},
}

// Takes says whether a list holds a value (a platform's formats).
func Takes(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// DescribeAcceptedFormats is "text posts, posts with an image and videos",
// or "videos only".
func DescribeAcceptedFormats(platform string) string {
	formats := PlatformRules[platform].Formats
	if len(formats) == 1 {
		return formatPlurals[formats[0]] + " only"
	}
	text := ""
	for i, format := range formats {
		switch {
		case i == 0:
			text = formatPlurals[format]
		case i == len(formats)-1:
			text += " and " + formatPlurals[format]
		default:
			text += ", " + formatPlurals[format]
		}
	}
	return text
}
