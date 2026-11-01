package config

import (
	"strings"
	"testing"
)

func settings(values map[string]string) Getenv {
	return func(name string) string { return values[name] }
}

var good = map[string]string{
	"DATABASE_URL":        "postgres://ansa:pw@localhost:5432/ansa",
	"DATA_ENCRYPTION_KEY": "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
	"BRAIN_SHARED_SECRET": strings.Repeat("s", 40),
	"BETTER_AUTH_SECRET":  strings.Repeat("a", 40),
}

func TestGoodSettingsLoadWithDefaults(t *testing.T) {
	cfg, err := Load(settings(good))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.ListenAddr != "127.0.0.1:8080" || cfg.BrainURL != "http://127.0.0.1:8090" || cfg.IsProduction() {
		t.Fatalf("defaults: %+v", cfg)
	}
}

func TestBadSettingsAreNamedNeverShown(t *testing.T) {
	bad := map[string]string{"DATABASE_URL": "mysql://secret-password@db", "DATA_ENCRYPTION_KEY": "short", "BRAIN_SHARED_SECRET": "tiny"}
	_, err := Load(settings(bad))
	if err == nil {
		t.Fatal("bad settings must stop the service")
	}
	for _, name := range []string{"DATABASE_URL", "DATA_ENCRYPTION_KEY", "BRAIN_SHARED_SECRET"} {
		if !strings.Contains(err.Error(), name) {
			t.Fatalf("%s isn't named: %v", name, err)
		}
	}
	if strings.Contains(err.Error(), "secret-password") || strings.Contains(err.Error(), "tiny") {
		t.Fatalf("a value leaked into the message: %v", err)
	}
}

func TestEmailSettingsGoTogether(t *testing.T) {
	values := map[string]string{"SEND_REAL_EMAIL": "true", "RESEND_API_KEY": "re_secret_value"}
	for name, value := range good {
		values[name] = value
	}
	_, err := Load(settings(values))
	if err == nil || !strings.Contains(err.Error(), "EMAIL_FROM") || strings.Contains(err.Error(), "re_secret_value") {
		t.Fatalf("real email needs its sender, named never shown: %v", err)
	}
	values["ANSA_ENV"] = "production"
	values["SEND_REAL_EMAIL"] = ""
	_, err = Load(settings(values))
	if err == nil || !strings.Contains(err.Error(), "SEND_REAL_EMAIL") || !strings.Contains(err.Error(), "APP_URL") {
		t.Fatalf("production needs real email and an https address: %v", err)
	}
}
