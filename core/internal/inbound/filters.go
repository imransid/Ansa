package inbound

import (
	"context"
	"regexp"
	"strings"
	"time"

	"ansa/core/internal/ratelimit"
	"ansa/core/internal/tenant"
)

// 10 emails an hour per sender (the old counter).
var floodLimit = ratelimit.Rule{MaxAttempts: 10, Window: time.Hour}

var bounceSender = regexp.MustCompile(`^(mailer-daemon|postmaster)@`)
var listIDName = regexp.MustCompile(`<([^<>]+)>\s*$`)

// reasonToIgnore is why an email must not become a request on its own, or
// "": the company's own support address (unless its own Google Group passes
// on a customer's email), an automatic reply, bulk mail, a bounce, a flood.
// Nothing is lost: the Emails page lists each, with "Make a ticket anyway".
func reasonToIgnore(ctx context.Context, limiter *ratelimit.Limiter, company tenant.CompanyID, s Sender, headers map[string]string, support []string) (string, error) {
	if s.Own == "company" && !(s.Address != "" && s.ReplyTo != "" && isOwnList(header(headers, "list-id"), []string{s.Address})) {
		return "support_address", nil
	}
	if isAutomaticReply(headers) {
		return "auto_reply", nil
	}
	precedence := strings.ToLower(strings.TrimSpace(header(headers, "precedence")))
	listID := header(headers, "list-id")
	bulk := precedence == "bulk" || precedence == "junk" || precedence == "list" || strings.TrimSpace(listID) != "" || strings.TrimSpace(header(headers, "list-unsubscribe")) != ""
	if bulk && !isOwnList(listID, support) {
		return "bulk", nil
	}
	if bounceSender.MatchString(s.Shown) {
		return "bounce", nil
	}
	over, err := limiter.Over(ctx, "inbound-email", company.String()+":"+s.FloodKey, floodLimit)
	if over {
		return "rate_limited", err
	}
	return "", err
}

// isAutomaticReply: Auto-Submitted (anything but "no"), X-Autoreply,
// X-Autorespond, Precedence: auto_reply, or an empty Return-Path.
func isAutomaticReply(headers map[string]string) bool {
	for _, name := range []string{"auto-submitted", "x-autoreply", "x-autorespond"} {
		if value := strings.ToLower(strings.TrimSpace(header(headers, name))); value != "" && value != "no" {
			return true
		}
	}
	return strings.ToLower(strings.TrimSpace(header(headers, "precedence"))) == "auto_reply" || strings.TrimSpace(header(headers, "return-path")) == "<>"
}

// isOwnList: a list writes its own address with "@" as a dot
// (support@acme.com -> List-Id: <support.acme.com>), as Google Groups does.
func isOwnList(listID string, support []string) bool {
	match := listIDName.FindStringSubmatch(listID)
	if match == nil {
		return false
	}
	name := strings.ToLower(strings.TrimSpace(match[1]))
	for _, address := range support {
		if strings.Replace(address, "@", ".", 1) == name {
			return true
		}
	}
	return false
}
