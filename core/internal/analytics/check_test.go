package analytics

import (
	"reflect"
	"testing"
	"time"
)

func TestNumbersAreFoundInAnyScriptsDigits(t *testing.T) {
	got := numbersWrittenIn("بازدیدها ۴۰٪ و ٤٠ و ४० و ４０ و 1,234 at 09:00")
	if want := []string{"۴۰", "٤٠", "४०", "40", "1,234"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q", got)
	}
	if got := numbersWrittenIn("P3 and H2 at 9:30, 3x, 1.2k, 24:00, 123:45, x_7"); !reflect.DeepEqual(got, []string{"3", "1.2", "24", "00", "123", "45"}) {
		t.Fatalf("labels, times and words: %q", got)
	}
	cases := []struct {
		text    string
		allowed []float64
		names   []string
		ok      bool
	}{
		{"بازدیدهای لینکدین ۴۰٪ بیشتر شد.", []float64{600}, nil, false},
		{"Views rose ４０% on LinkedIn.", []float64{600}, nil, false},
		{"P5 got the most reactions (８).", []float64{8}, nil, true},
		{"P5 got the most reactions (۸).", []float64{8}, nil, false},
		{"P3, «۵ نان برتر», did well.", []float64{6}, []string{"۵ نان برتر"}, true},
		{"Posts got 1,234 and 1.234 views, 6,5 per post.", []float64{1234, 6.5}, nil, true},
	}
	for _, c := range cases {
		if writesOnlyAllowedNumbers(c.text, c.allowed, c.names) != c.ok {
			t.Fatalf("%q: want %v", c.text, c.ok)
		}
	}
}

// fivePosts: P1-P5 with views 100-140 and reactions 4-8; P1, P3 and P5 in
// the pillar (G2), P2 and P4 in none (G3), all on LinkedIn (G1).
func fivePosts() ReviewInput {
	start := time.Date(2026, 10, 1, 8, 0, 0, 0, time.UTC)
	var posts []PublishedPost
	for index := range 5 {
		pillar := ""
		if index%2 == 0 {
			pillar = "Behind the oven"
		}
		posts = append(posts, PublishedPost{Platform: "linkedin", Format: "post", Pillar: pillar, Topic: "Post " + string(rune('1'+index)),
			PublishedAt: start.Add(time.Duration(index) * 24 * time.Hour),
			Latest:      snapshotOf("dev_simulated", map[string]int64{"views": int64(100 + index*10), "reactions": int64(index + 4)})})
	}
	lisbon, _ := time.LoadLocation("Europe/Lisbon")
	return buildReviewInput(posts, 5, Bounds{Days: 30, Start: start.Add(-24 * time.Hour), End: start.Add(29 * 24 * time.Hour)}, lisbon)
}

func TestTheInputIsLabeledAndGrouped(t *testing.T) {
	input := fivePosts()
	if input.Posts[0].Label != "P1" || input.Posts[0].Weekday != "Thursday" || input.Posts[0].Hour != "09:00" || !input.Simulated {
		t.Fatalf("P1 in Lisbon's time: %+v", input.Posts[0])
	}
	want := []ReviewGroup{
		{Label: "G1", Kind: "platform", Name: "LinkedIn", Numbers: Numbers{"posts": 5, "views_total": 600, "views_posts": 5, "views_per_post": 120, "reactions_total": 30, "reactions_posts": 5, "reactions_per_post": 6}},
		{Label: "G2", Kind: "pillar", Name: "Behind the oven", Numbers: Numbers{"posts": 3, "views_total": 360, "views_posts": 3, "views_per_post": 120, "reactions_total": 18, "reactions_posts": 3, "reactions_per_post": 6}},
		{Label: "G3", Kind: "no_pillar", Name: "", Numbers: Numbers{"posts": 2, "views_total": 240, "views_posts": 2, "views_per_post": 120, "reactions_total": 12, "reactions_posts": 2, "reactions_per_post": 6}},
	}
	if !reflect.DeepEqual(input.Groups, want) || input.Period.Start != "2026-09-30T08:00:00.000Z" || input.TimeZone != "Europe/Lisbon" {
		t.Fatalf("groups: %+v %+v", input.Groups, input.Period)
	}
}

var (
	mostReactions = Finding{Text: "P5 got the most reactions of the period.", Evidence: []Evidence{{PostLabel: "P5", Metric: "reactions", Value: 8}}}
	pillarAverage = Finding{Text: "Posts in the pillar averaged 120 views each.", Evidence: []Evidence{{Group: "G2", Metric: "views_per_post", Value: 120}}}
	quotedTopic   = Finding{Text: "P3, titled Post 3, kept up with the others.", Evidence: []Evidence{{PostLabel: "P3", Metric: "reactions", Value: 6}}}
	dropped       = []Finding{
		{Text: "P4 got the most views.", Evidence: []Evidence{{PostLabel: "P4", Metric: "views", Value: 131}}},
		{Text: "P9 did best.", Evidence: []Evidence{{PostLabel: "P9", Metric: "views", Value: 100}}},
		{Text: "P1 led the views.", Evidence: []Evidence{{PostLabel: "P1", Metric: "views_total", Value: 100}}},
		{Text: "P1 is part of it.", Evidence: []Evidence{{PostLabel: "P1", Group: "G1", Metric: "views", Value: 100}}},
		{Text: "Views rose 40% on LinkedIn.", Evidence: []Evidence{{Group: "G1", Metric: "views_total", Value: 600}}},
		{Text: "Tuesdays work best.", Evidence: []Evidence{}},
		{Text: "بازدیدهای لینکدین ۴۰٪ بیشتر شد.", Evidence: []Evidence{{Group: "G1", Metric: "views_total", Value: 600}}},
		{Text: "Views rose ４０% on LinkedIn.", Evidence: []Evidence{{Group: "G1", Metric: "views_total", Value: 600}}},
	}
)

func TestOnlyFindingsWhoseEveryNumberChecksOutAreKept(t *testing.T) {
	findings := []Finding{mostReactions, dropped[0], dropped[1], dropped[2], dropped[3], dropped[4], pillarAverage, dropped[5], quotedTopic, dropped[6], dropped[7]}
	answer := Review{Findings: findings,
		Recommendations: []Recommendation{
			{Text: "Write more posts like P5 for the pillar.", BasedOn: []int{1, 7}},
			{Text: "Try what P4 did again.", BasedOn: []int{2}},
			{Text: "Post 3 times a week.", BasedOn: []int{1}},
			{Text: "Keep posting at 09:00 on weekdays.", BasedOn: []int{7, 7, 42}},
		},
		Limits: []string{"Only 5 posts had numbers in this period.", "A whole year would show 365 days of trends."},
	}
	want := &Review{Findings: []Finding{mostReactions, pillarAverage, quotedTopic},
		Recommendations: []Recommendation{{Text: "Write more posts like P5 for the pillar.", BasedOn: []int{1, 2}}, {Text: "Keep posting at 09:00 on weekdays.", BasedOn: []int{2}}},
		Limits:          []string{"Only 5 posts had numbers in this period."},
	}
	if got := checkReview(answer, fivePosts()); !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v", got)
	}
	allWrong := Review{Findings: dropped, Recommendations: []Recommendation{{Text: "Do more.", BasedOn: []int{1}}}, Limits: []string{"Few posts."}}
	if checkReview(allWrong, fivePosts()) != nil {
		t.Fatal("no finding left = no review")
	}
}

func TestTextsAreOnePlainLineCutAtAWord(t *testing.T) {
	if got := cleanText("  Two\nlines\u200b here ", 500); got != "Two lines here" {
		t.Fatalf("got %q", got)
	}
	long := "🙂"
	for len([]rune(long)) < 600 {
		long += " word"
	}
	if cut := cleanText(long, 500); len([]rune(cut)) != 494 || cut[len(cut)-8:] != " word..." {
		t.Fatalf("cut at a word, the emoji counted as two: %q", cut)
	}
	if got := cleanText("aaaaaaa🙂bbbbb", 11); got != "aaaaaaa..." {
		t.Fatalf("a cut never splits an emoji: %q", got)
	}
}

// What the old TypeScript wrote for the same texts (cutPlanText(
// toPlainSingleLine(text), 20) and numbersWrittenIn), run with Node.
func TestTheOldRulesWordForWord(t *testing.T) {
	cases := []struct {
		text, cut string
		numbers   []string
	}{
		{"P3 and H2 at 9:30, 3x, 1.2k, 24:00, 123:45, x_7", "P3 and H2 at...", []string{"3", "1.2", "24", "00", "123", "45"}},
		{"19:305 and 1:2:30 and 23:59x and 2:3", "19:305 and...", []string{"19", "305", "1", "2", "3"}},
		{"aaaaaaa🙂bbbbbbbbbbbbbbbbbb", "aaaaaaa🙂bbbbbbbb...", nil},
		{"one two three four five six", "one two three...", nil},
		{"日本語のテキストはスペースがほとんどありません", "日本語のテキストはスペースがほとん...", nil},
		{"  a\u2028b\u200bc  \u00a0d\ufeff  ", "a bc d", nil},
		{"①② ³ ٣.٤ 1,,2 1.,2 .5 5. 0009:00", "①② ³ ٣.٤ 1,,2...", []string{"12", "3", "٣.٤", "1", "2", "1", "2", "5", "5", "0009", "00"}},
		{"abc 9:300 1:00:00 x9:00 ٩:00", "abc 9:300...", []string{"9", "300", "00", "٩", "00"}},
		{"a🙂 b🙂 c🙂 d🙂 e🙂 f🙂 g🙂", "a🙂 b🙂 c🙂 d🙂...", nil},
		{"1٫5 ７：３０ 12:3４", "1٫5 ７：３０ 12:3４", []string{"1", "5"}},
	}
	for _, c := range cases {
		if got := cleanText(c.text, 20); got != c.cut {
			t.Fatalf("%q: cut %q, the old %q", c.text, got, c.cut)
		}
		if got := numbersWrittenIn(c.text); !reflect.DeepEqual(got, c.numbers) {
			t.Fatalf("%q: numbers %q, the old %q", c.text, got, c.numbers)
		}
	}
}
