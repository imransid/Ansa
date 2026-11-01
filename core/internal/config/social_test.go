package config

import (
	"strings"
	"testing"
)

func TestEachSocialAppsIDAndSecretGoTogether(t *testing.T) {
	for _, pair := range socialAppPairs {
		for _, half := range pair {
			values := map[string]string{half: "half-a-pair-value"}
			for name, value := range good {
				values[name] = value
			}
			_, err := Load(settings(values))
			if err == nil || !strings.Contains(err.Error(), pair[0]+" and "+pair[1]+" must be set together") || strings.Contains(err.Error(), "half-a-pair-value") {
				t.Fatalf("%s alone must stop the server, named never shown: %v", half, err)
			}
		}
	}
	values := map[string]string{"X_CLIENT_ID": "x-id", "X_CLIENT_SECRET": "x-secret"}
	for name, value := range good {
		values[name] = value
	}
	cfg, err := Load(settings(values))
	if err != nil || cfg.XClientID != "x-id" || cfg.XClientSecret != "x-secret" || cfg.LinkedInClientID != "" {
		t.Fatalf("a whole pair loads: %v", err)
	}
}
