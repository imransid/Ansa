package config

import (
	"net"
	"net/url"
	"strings"
)

// The ansa phone app's settings (core/internal/devices).

// What a phone reaches core at in development: the iPhone simulator
// reaches the laptop there (the Android emulator at http://10.0.2.2:8080; a
// real phone on the Wi-Fi needs DEVICE_LISTEN_ADDR and the laptop's address).
const developmentDeviceAPIURL = "http://127.0.0.1:8080"

// readDevices reads DEVICE_API_URL and DEVICE_LISTEN_ADDR (after ANSA_ENV).
func readDevices(cfg *Config, getenv Getenv) {
	cfg.DeviceAPIURL = strings.TrimRight(strings.TrimSpace(getenv("DEVICE_API_URL")), "/")
	if cfg.DeviceAPIURL == "" && cfg.Environment == "development" {
		cfg.DeviceAPIURL = developmentDeviceAPIURL
	}
	cfg.DeviceListenAddr = strings.TrimSpace(getenv("DEVICE_LISTEN_ADDR"))
}

// deviceProblems: DEVICE_API_URL is an http(s) address with nothing but a
// host (and port, and maybe a path), https in production (where it is
// required: the pairing link holds it); DEVICE_LISTEN_ADDR is a
// development-only address of its own.
func deviceProblems(cfg Config) []string {
	var problems []string
	address, err := url.Parse(cfg.DeviceAPIURL)
	usable := err == nil && address.Host != "" && address.User == nil && address.RawQuery == "" && address.Fragment == ""
	switch {
	case cfg.IsProduction() && (!usable || address.Scheme != "https"):
		problems = append(problems, "DEVICE_API_URL must be core's https address for the phone app (required in production)")
	case !usable || (address.Scheme != "http" && address.Scheme != "https"):
		problems = append(problems, "DEVICE_API_URL must be an http(s) address with no query (development default http://127.0.0.1:8080)")
	}
	if cfg.DeviceListenAddr == "" {
		return problems
	}
	if cfg.IsProduction() {
		return append(problems, "DEVICE_LISTEN_ADDR is for development only (production serves /device/v1/ on CORE_LISTEN_ADDR, behind https)")
	}
	if _, port, err := net.SplitHostPort(cfg.DeviceListenAddr); err != nil || port == "" || cfg.DeviceListenAddr == cfg.ListenAddr {
		problems = append(problems, "DEVICE_LISTEN_ADDR must be an address and port of its own, e.g. 0.0.0.0:8085")
	}
	return problems
}
