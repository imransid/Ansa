package resend

import (
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
