package inbound

import (
	"strings"
	"testing"
	"time"
)

// An email (or a web page) full of skipped elements is read in time in
// proportion to its length: when each one lower-cased the rest of the
// document, 1 MB of <svg></svg> took about a minute, holding a worker.
func TestManySkippedElementsAreReadQuickly(t *testing.T) {
	document := strings.Repeat("<svg></svg>", 200_000) + "<p>Hello</p>"
	read := make(chan string, 1)
	go func() { read <- HTMLToText(document, 1000) }()
	select {
	case got := <-read:
		if got != "Hello" {
			t.Fatalf("text: %q", got)
		}
	case <-time.After(time.Second):
		t.Fatal("2 MB of <svg></svg> took more than a second")
	}
}

// A closing tag is found where it really is, whatever comes before it: İ
// lower-cased by strings.ToLower is one byte shorter, which cut the title
// early and showed its end as the email's text.
func TestATitleStaysOutWhateverItsLetters(t *testing.T) {
	document := "<title>" + strings.Repeat("İ", 12) + " Sipariş > İade</title><p>Merhaba, siparişim gelmedi.</p>"
	if got := HTMLToText(document, 1000); got != "Merhaba, siparişim gelmedi." {
		t.Fatalf("text: %q", got)
	}
	if got := HTMLToText("<STYLE>p{}</Style><SCRIPT>x()</sCrIpT><P>Hi</P>", 1000); got != "Hi" {
		t.Fatalf("capital tags: %q", got)
	}
}
