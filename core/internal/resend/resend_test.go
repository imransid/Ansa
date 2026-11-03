package resend

import (
	"context"
	"encoding/base64"
	"testing"
	"time"
)

var secret = "whsec_" + base64.StdEncoding.EncodeToString([]byte("resend-test-secret-0123456789"))

func TestOnlyResendsSignatureCounts(t *testing.T) {
	body := []byte(`{"type":"email.received"}`)
	now := time.Now()
	headers := Sign(body, "msg_1", secret, now)
	if !IsSigned(headers, body, secret, now) {
		t.Fatal("Resend's own signature")
	}
	if IsSigned(headers, []byte(`{"type":"email.bounced"}`), secret, now) {
		t.Fatal("a changed body")
	}
	if IsSigned(Sign(body, "msg_1", secret, now.Add(-10*time.Minute)), body, secret, now) {
		t.Fatal("an old event")
	}
	other := "whsec_" + base64.StdEncoding.EncodeToString([]byte("another-secret-entirely-000"))
	if IsSigned(Sign(body, "msg_1", other, now), body, secret, now) {
		t.Fatal("another secret")
	}
}

// The development inbox: the fetcher reads what WriteDevInbound wrote, and
// an id the fetcher would refuse (a path) is never written.
func TestTheDevelopmentFetcherReadsWhatWasWrittenForIt(t *testing.T) {
	folder := t.TempDir()
	content := map[string]any{"from": "ana@shop.example", "subject": "Hi", "authentication": map[string]string{"dkim": "pass"}}
	if err := WriteDevInbound(folder, "practice-1", content); err != nil {
		t.Fatal(err)
	}
	read, code := (&Fetcher{DevFolder: folder}).Fetch(context.Background(), "practice-1")
	if read == nil || read.From != "ana@shop.example" || read.Subject != "Hi" || read.Authentication == nil || read.Authentication.DKIM != "pass" {
		t.Fatalf("read back: %+v %s", read, code)
	}
	if WriteDevInbound(folder, "../elsewhere", content) == nil {
		t.Fatal("an id naming a path")
	}
}

func TestOnlyAnsasForwardingAddressesNameACompany(t *testing.T) {
	token := "0123456789abcdef0123456789abcdef"
	recipients := []string{"Shop <c-" + token + "@inbound.ansa.test>", "c-" + token + "@INBOUND.ANSA.TEST", "c-" + token + "@evil.example", "support@shop.example"}
	if got := forwardingTokens(recipients, "inbound.ansa.test"); len(got) != 1 || got[0] != token {
		t.Fatalf("tokens: %v", got)
	}
	if got := recipientList([]byte(`"one@x.com"`)); len(got) != 1 {
		t.Fatal("a single address is a list")
	}
}
