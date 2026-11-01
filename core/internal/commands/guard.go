package commands

import (
	"net"
	"net/url"
	"strings"

	"ansa/core/internal/config"
)

// The development tools write made-up rows (customers, calls, emails,
// numbers) and send made-up webhooks. They must never reach a real
// company's data: never in production, only a database on this computer,
// and only a core on this computer (the old checks' rule).

var localHosts = map[string]bool{"localhost": true, "127.0.0.1": true, "::1": true}

// IsLocalHost: a host name of this computer.
func IsLocalHost(host string) bool {
	return localHosts[strings.ToLower(host)]
}

// ReasonNotToRun is why a development tool must not run with these settings
// ("" = it may). Never names a value: DATABASE_URL holds a password.
func ReasonNotToRun(cfg config.Config) string {
	if cfg.IsProduction() {
		return "ANSA_ENV is production"
	}
	parsed, err := url.Parse(cfg.DatabaseURL)
	if err != nil || !IsLocalHost(parsed.Hostname()) {
		return "DATABASE_URL doesn't point at localhost or 127.0.0.1"
	}
	return ""
}

// CoreAddress is where a simulator sends its webhooks: the address given
// (--core), else the running core's own (CORE_LISTEN_ADDR). Only http(s)
// on this computer, so a made-up call or email never reaches a real server.
func CoreAddress(given string, cfg config.Config) (string, error) {
	if given == "" {
		given = "http://" + listenAddress(cfg.ListenAddr)
	}
	parsed, err := url.Parse(strings.TrimRight(given, "/"))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || !IsLocalHost(parsed.Hostname()) || parsed.Path != "" || parsed.RawQuery != "" {
		return "", Refusal("The core address must be http://localhost:<port> or http://127.0.0.1:<port> (a core on this computer).")
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}

// listenAddress turns a listening address (":8080", "0.0.0.0:8080") into
// one to send to.
func listenAddress(listen string) string {
	host, port, err := net.SplitHostPort(listen)
	if err != nil {
		return listen
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return net.JoinHostPort(host, port)
}
