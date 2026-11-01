package ratelimit

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"testing"
	"time"

	"ansa/core/internal/database"
)

// The old backend's key for ("login", "198.51.100.7") with this secret,
// computed with its own code (services/rate-limit.ts).
func TestKeysEqualTheOldBackends(t *testing.T) {
	limiter := New(nil, "test-secret-test-secret-test-secret-00")
	if got := limiter.Key("login", "198.51.100.7"); got != oldBackendKey {
		t.Fatalf("got %s, want %s", got, oldBackendKey)
	}
}

func TestOverCountsWithinTheWindowAndTakesBack(t *testing.T) {
	pool := database.ForTest(t)
	limiter := New(pool, "test-secret-test-secret-test-secret-00")
	caller := randomCaller(t)
	rule := Rule{MaxAttempts: 2, Window: time.Minute}
	ctx := context.Background()
	for attempt := 1; attempt <= 3; attempt++ {
		over, err := limiter.Over(ctx, "core-test", caller, rule)
		if err != nil {
			t.Fatalf("Over: %v", err)
		}
		if over != (attempt == 3) {
			t.Fatalf("attempt %d: over=%v", attempt, over)
		}
	}
	if err := limiter.TakeBack(ctx, "core-test", caller); err != nil {
		t.Fatalf("TakeBack: %v", err)
	}
	if over, _ := limiter.Over(ctx, "core-test", caller, rule); !over {
		t.Fatal("after taking one back, the next attempt is the third again: over")
	}
	pool.Exec(ctx, `DELETE FROM rate_limits WHERE key = $1`, limiter.Key("core-test", caller))
}

func randomCaller(t *testing.T) string {
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(bytes)
}

const oldBackendKey = "a2c08e709caf0a66fb993b0c64bd98ec52b24fde18b4d47b83a08993f6b9774f"
