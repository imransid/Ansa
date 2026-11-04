package config

import (
	"strings"
	"testing"
)

func withSettings(changes map[string]string) map[string]string {
	values := map[string]string{}
	for name, value := range good {
		values[name] = value
	}
	for name, value := range changes {
		values[name] = value
	}
	return values
}

// Development: a phone reaches the laptop at 127.0.0.1:8080 unless said
// otherwise, and no LAN listener runs unless asked for.
func TestThePhoneAppsAddressInDevelopment(t *testing.T) {
	cfg, err := Load(settings(good))
	if err != nil || cfg.DeviceAPIURL != "http://127.0.0.1:8080" || cfg.DeviceListenAddr != "" {
		t.Fatalf("defaults: %q %q %v", cfg.DeviceAPIURL, cfg.DeviceListenAddr, err)
	}
	cfg, err = Load(settings(withSettings(map[string]string{"DEVICE_API_URL": "http://192.168.1.20:8081/", "DEVICE_LISTEN_ADDR": "0.0.0.0:8081"})))
	if err != nil || cfg.DeviceAPIURL != "http://192.168.1.20:8081" || cfg.DeviceListenAddr != "0.0.0.0:8081" {
		t.Fatalf("a laptop on the Wi-Fi: %q %q %v", cfg.DeviceAPIURL, cfg.DeviceListenAddr, err)
	}
	for _, bad := range []map[string]string{
		{"DEVICE_API_URL": "ftp://example.com"},
		{"DEVICE_API_URL": "http://example.com/?x=1"},
		{"DEVICE_LISTEN_ADDR": "8081"},
		{"DEVICE_LISTEN_ADDR": "127.0.0.1:8080"},
	} {
		if _, err := Load(settings(withSettings(bad))); err == nil || !strings.Contains(err.Error(), "DEVICE_") {
			t.Fatalf("%v must be refused: %v", bad, err)
		}
	}
}

// Production: DEVICE_API_URL is required and https; the LAN listener is
// refused (the app's routes are on core's own address, behind https).
func TestThePhoneAppsSettingsInProduction(t *testing.T) {
	production := map[string]string{"ANSA_ENV": "production"}
	_, err := Load(settings(withSettings(production)))
	if err == nil || !strings.Contains(err.Error(), "DEVICE_API_URL") {
		t.Fatalf("required in production: %v", err)
	}
	production["DEVICE_API_URL"] = "http://core.ansa.app"
	if _, err := Load(settings(withSettings(production))); err == nil || !strings.Contains(err.Error(), "DEVICE_API_URL") {
		t.Fatalf("https in production: %v", err)
	}
	production["DEVICE_API_URL"] = "https://core.ansa.app"
	production["DEVICE_LISTEN_ADDR"] = "0.0.0.0:8081"
	_, err = Load(settings(withSettings(production)))
	if err == nil || !strings.Contains(err.Error(), "DEVICE_LISTEN_ADDR") || strings.Contains(err.Error(), "DEVICE_API_URL") {
		t.Fatalf("an https address passes, the LAN listener doesn't: %v", err)
	}
}
