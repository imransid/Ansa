package resend

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

// devInboundFile is where the development fetcher reads a received email's
// content: <devFolder>/.dev-inbound/<Resend's id>.json, the stand-in for
// what Resend's Receiving API keeps.
func devInboundFile(devFolder, resendEmailID string) string {
	return filepath.Join(devFolder, ".dev-inbound", resendEmailID+".json")
}

// WriteDevInbound writes a received email's content where the development
// fetcher reads it, in the shape of Resend's Receiving API (the simulate
// tools' emails, and the practice email: core/internal/practicechat).
func WriteDevInbound(devFolder, resendEmailID string, content any) error {
	if !resendIDPattern.MatchString(resendEmailID) {
		return errors.New("resend: an email id the fetcher would refuse")
	}
	raw, err := json.Marshal(content)
	if err != nil {
		return err
	}
	file := devInboundFile(devFolder, resendEmailID)
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		return err
	}
	return os.WriteFile(file, raw, 0o600)
}
