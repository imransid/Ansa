package plaintext

import "testing"

func TestSingleLine(t *testing.T) {
	cases := map[string]string{
		"  Cold\r\npizza\t again  ": "Cold pizza again",
		"gpj\u202e.exe":                  "gpj.exe",
		"zero\u200bwidth":                "zerowidth",
		"line\u2028sep\u2029para\x00nul":      "line sep para nul",
		"\n\n":                      "",
		"Ana 👩\u200d🍳":                   "Ana 👩🍳",
	}
	for input, want := range cases {
		if got := SingleLine(input); got != want {
			t.Errorf("SingleLine(%q) = %q, want %q", input, got, want)
		}
	}
}
