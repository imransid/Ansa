package brainclient

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSignatureCoversTimestampAndBody(t *testing.T) {
	at := time.Unix(1_800_000_000, 0)
	timestamp, signature := Sign("secret", []byte(`{"a":1}`), at)
	mac := hmac.New(sha256.New, []byte("secret"))
	mac.Write([]byte("1800000000.{\"a\":1}"))
	if timestamp != "1800000000" || signature != hex.EncodeToString(mac.Sum(nil)) {
		t.Fatalf("got %s %s", timestamp, signature)
	}
	_, other := Sign("secret", []byte(`{"a":2}`), at)
	if other == signature {
		t.Fatal("another body must give another signature")
	}
}

func TestCallSendsASignedRequestAndReadsTheAnswer(t *testing.T) {
	brain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		timestamp := r.Header.Get(TimestampHeader)
		mac := hmac.New(sha256.New, []byte("secret"))
		mac.Write([]byte(timestamp + "." + string(body)))
		if r.Header.Get(SignatureHeader) != hex.EncodeToString(mac.Sum(nil)) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Write([]byte(`{"action":"no_reply"}`))
	}))
	defer brain.Close()
	var answer struct{ Action string }
	if err := New(brain.URL, "secret", time.Second).Call(context.Background(), "/v1/test", map[string]string{"x": "y"}, &answer); err != nil || answer.Action != "no_reply" {
		t.Fatalf("got %+v, %v", answer, err)
	}
	if err := New(brain.URL, "wrong", time.Second).Call(context.Background(), "/v1/test", map[string]string{}, &answer); err != ErrBrainUnavailable {
		t.Fatalf("a refused request must be ErrBrainUnavailable, got %v", err)
	}
}
