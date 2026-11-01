package config

import (
	"strconv"
	"strings"
)

// readVapi reads the VAPI_* settings with the old backend's defaults (a
// Vapi HMAC credential's own: x-signature, x-timestamp, sha256 over
// "{timestamp}.{body}", hex, seconds, 5 minutes).
func readVapi(cfg *Config, getenv Getenv) {
	cfg.VapiWebhookSecret = getenv("VAPI_WEBHOOK_SECRET")
	cfg.VapiSignatureHeader = strings.ToLower(withDefault(getenv("VAPI_SIGNATURE_HEADER"), "x-signature"))
	cfg.VapiTimestampHeader = strings.ToLower(withDefault(getenv("VAPI_TIMESTAMP_HEADER"), "x-timestamp"))
	cfg.VapiSignatureAlgorithm = withDefault(getenv("VAPI_SIGNATURE_ALGORITHM"), "sha256")
	cfg.VapiSignaturePayload = withDefault(getenv("VAPI_SIGNATURE_PAYLOAD"), "{timestamp}.{body}")
	cfg.VapiSignatureEncoding = withDefault(getenv("VAPI_SIGNATURE_ENCODING"), "hex")
	cfg.VapiSignaturePrefix = getenv("VAPI_SIGNATURE_PREFIX")
	cfg.VapiTimestampUnit = withDefault(getenv("VAPI_TIMESTAMP_UNIT"), "seconds")
	cfg.VapiToleranceSeconds = -1
	if seconds, err := strconv.Atoi(withDefault(getenv("VAPI_TIMESTAMP_TOLERANCE_SECONDS"), "300")); err == nil {
		cfg.VapiToleranceSeconds = seconds
	}
	for _, host := range strings.Split(withDefault(getenv("VAPI_RECORDING_HOSTS"), "storage.vapi.ai"), ",") {
		if host = strings.ToLower(strings.TrimSpace(host)); host != "" {
			cfg.VapiRecordingHosts = append(cfg.VapiRecordingHosts, host)
		}
	}
}

// vapiProblems checks the Vapi settings.
func vapiProblems(cfg Config) []string {
	var problems []string
	if cfg.VapiWebhookSecret != "" && len(cfg.VapiWebhookSecret) < 32 {
		problems = append(problems, "VAPI_WEBHOOK_SECRET must be at least 32 characters")
	}
	if !oneOf(cfg.VapiSignatureAlgorithm, "sha256", "sha512", "sha1") {
		problems = append(problems, `VAPI_SIGNATURE_ALGORITHM must be "sha256", "sha512" or "sha1"`)
	}
	if !oneOf(cfg.VapiSignaturePayload, "{timestamp}.{body}", "{body}") {
		problems = append(problems, `VAPI_SIGNATURE_PAYLOAD must be "{timestamp}.{body}" or "{body}"`)
	}
	if !oneOf(cfg.VapiSignatureEncoding, "hex", "base64") {
		problems = append(problems, `VAPI_SIGNATURE_ENCODING must be "hex" or "base64"`)
	}
	if !oneOf(cfg.VapiTimestampUnit, "seconds", "milliseconds") {
		problems = append(problems, `VAPI_TIMESTAMP_UNIT must be "seconds" or "milliseconds"`)
	}
	if cfg.VapiToleranceSeconds < 30 || cfg.VapiToleranceSeconds > 3600 {
		problems = append(problems, "VAPI_TIMESTAMP_TOLERANCE_SECONDS must be a whole number from 30 to 3600")
	}
	return problems
}

func oneOf(value string, allowed ...string) bool {
	for _, option := range allowed {
		if value == option {
			return true
		}
	}
	return false
}
