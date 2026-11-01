package accounts

import (
	"testing"
	"time"
)

// Made with Better Auth's own code (@better-auth/utils's hashPassword, and
// jose's SignJWT as Better Auth signs confirmation links), so a password or
// a link made by the old backend works here, and the other way round.
const (
	betterAuthHash  = "fc411acb52e15b9e465bfda227e32771:978078559e9b6545ca25bca9e4b7a3ba2b0826c241cdbccd7606b3d9b212a7d4548169f7ffa1569e0c140b1c1d834982255ca798e952d23934181b9cf4a78432"
	betterAuthToken = "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImFuYUBleGFtcGxlLmNvbSIsImlhdCI6MTgwMDAwMDAwMCwiZXhwIjo0MDAwMDAwMDAwfQ.gPH_u-c5s3laFZtapN7lcc6-oYwOShLyYiuGRcNrv8g"
	vectorSecret    = "a-test-secret-of-at-least-32-characters!!"
)

func TestBetterAuthsPasswordsAndLinksWorkHere(t *testing.T) {
	if !VerifyPassword(betterAuthHash, "correct horse battery") || VerifyPassword(betterAuthHash, "correct horse batterY") {
		t.Fatal("a password Better Auth stored")
	}
	ours, err := HashPassword("ﬁve fine words here")
	if err != nil || !VerifyPassword(ours, "five fine words here") {
		t.Fatal("our own, in its NFKC form")
	}
	at := time.Unix(1_900_000_000, 0)
	if emailOfSignupToken(betterAuthToken, vectorSecret, at) != "ana@example.com" {
		t.Fatal("a link Better Auth signed")
	}
	if emailOfSignupToken(betterAuthToken, "another-secret-of-at-least-32-characters", at) != "" {
		t.Fatal("another secret's link")
	}
	ourToken := signupToken("Bo@Example.com", vectorSecret, at)
	if emailOfSignupToken(ourToken, vectorSecret, at.Add(59*time.Minute)) != "bo@example.com" || emailOfSignupToken(ourToken, vectorSecret, at.Add(time.Hour)) != "" {
		t.Fatal("our link works for one hour")
	}
}
