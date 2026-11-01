package telegram

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSendReadsOnlyOkTheIdAndTheStatus(t *testing.T) {
	var got map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/botTOKEN/sendMessage") {
			w.WriteHeader(404)
			return
		}
		json.NewDecoder(r.Body).Decode(&got)
		switch got["text"] {
		case "slow down":
			w.WriteHeader(429)
		case "boom":
			w.WriteHeader(502)
		default:
			w.Write([]byte(`{"ok":true,"result":{"message_id":77,"text":"echo"}}`))
		}
	}))
	defer server.Close()
	old := APIHost
	APIHost = server.URL
	defer func() { APIHost = old }()

	sent := Send(context.Background(), "TOKEN", "555", "Hello!", "bc-1")
	if sent.Status != "sent" || sent.ChannelMessageID != "77" || got["business_connection_id"] != "bc-1" || got["chat_id"] != "555" {
		t.Fatalf("sent: %+v %v", sent, got)
	}
	if r := Send(context.Background(), "TOKEN", "555", "slow down", ""); r.Status != "failed" || r.Error != "rate_limited" {
		t.Fatalf("429: %+v", r)
	}
	if r := Send(context.Background(), "TOKEN", "555", "boom", ""); r.Status != "unclear" {
		t.Fatalf("5xx must be unclear: %+v", r)
	}
	if r := Send(context.Background(), "WRONG", "555", "hi", ""); r.Error != "bot_rejected" {
		t.Fatalf("a wrong token: %+v", r)
	}
}
