// Package config reads core's settings from the environment once, at start,
// and stops the service with a clear message when one is missing or wrong.
// The message names the setting and the rule, never its value
// (docs/backend/security.md, rule 2).
package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// Config is every setting core reads. Add a field here, in Load, in
// core/.env.example and in docs/backend/modules/config.md together.
type Config struct {
	// Where core listens, e.g. "127.0.0.1:8080".
	ListenAddr string
	// PostgreSQL, e.g. "postgres://user:pass@localhost:5432/ansa".
	DatabaseURL string
	// 32 bytes as base64: the same key as the old backend's DATA_ENCRYPTION_KEY.
	DataEncryptionKey string
	// The brain's private address, e.g. "http://127.0.0.1:8090".
	BrainURL string
	// Signs every request core sends the brain (at least 32 characters).
	BrainSharedSecret string
	// "development" or "production".
	Environment string
	// The old backend's BETTER_AUTH_SECRET: rate limit keys are derived from
	// it the same way (both backends share counters), and logins move here later.
	AuthSecret string
}

// Getenv reads one setting; os.Getenv in production, a map in tests.
type Getenv func(name string) string

// Load reads and checks every setting. All problems are reported at once.
func Load(getenv Getenv) (Config, error) {
	cfg := Config{
		ListenAddr:        withDefault(getenv("CORE_LISTEN_ADDR"), "127.0.0.1:8080"),
		DatabaseURL:       getenv("DATABASE_URL"),
		DataEncryptionKey: getenv("DATA_ENCRYPTION_KEY"),
		BrainURL:          withDefault(getenv("BRAIN_URL"), "http://127.0.0.1:8090"),
		BrainSharedSecret: getenv("BRAIN_SHARED_SECRET"),
		Environment:       withDefault(getenv("ANSA_ENV"), "development"),
		AuthSecret:        getenv("BETTER_AUTH_SECRET"),
	}
	var problems []string
	if !strings.HasPrefix(cfg.DatabaseURL, "postgres://") && !strings.HasPrefix(cfg.DatabaseURL, "postgresql://") {
		problems = append(problems, "DATABASE_URL must be a postgres:// address")
	}
	if key, err := base64.StdEncoding.DecodeString(cfg.DataEncryptionKey); err != nil || len(key) != 32 {
		problems = append(problems, "DATA_ENCRYPTION_KEY must be 32 bytes written as base64 (the old backend's key)")
	}
	if brain, err := url.Parse(cfg.BrainURL); err != nil || (brain.Scheme != "http" && brain.Scheme != "https") || brain.Host == "" {
		problems = append(problems, "BRAIN_URL must be an http(s) address")
	}
	if len(cfg.BrainSharedSecret) < 32 {
		problems = append(problems, "BRAIN_SHARED_SECRET must be at least 32 characters (openssl rand -hex 32)")
	}
	if len(cfg.AuthSecret) < 32 {
		problems = append(problems, "BETTER_AUTH_SECRET must be at least 32 characters (the old backend's value)")
	}
	if cfg.Environment != "development" && cfg.Environment != "production" {
		problems = append(problems, `ANSA_ENV must be "development" or "production"`)
	}
	if len(problems) > 0 {
		return Config{}, errors.New("settings: " + strings.Join(problems, "; "))
	}
	return cfg, nil
}

// IsProduction is true in production, where development stand-ins are refused.
func (c Config) IsProduction() bool {
	return c.Environment == "production"
}

func withDefault(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

// String never prints a secret: only which settings are set.
func (c Config) String() string {
	return fmt.Sprintf("listen=%s brain=%s env=%s", c.ListenAddr, c.BrainURL, c.Environment)
}
