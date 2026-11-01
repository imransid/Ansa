// Package publishing is the publishing queue (the old services/publish-*.ts,
// db/publish-*.ts, lib/publishing/): one post of one draft to one account
// is a publish_jobs row. Permission is decided when a post RUNS, on one
// snapshot, never trusted from when it was scheduled. The checks cover
// every platform and format ansa publishes (contentrules.PublishedFormats);
// core sends Facebook text and image posts today, and LinkedIn, X and
// YouTube plug in at senderFor (sender.go).
package publishing

// Draft is a draft as the checks read it.
type Draft struct {
	Platform, Format, Status, Pillar string
	Version                          int
	ApprovedByUserID                 *string
	ApprovedVersion                  *int
	// The AI's text with no hand edit since (generated_version = version),
	// and no claim that isn't backed: no owner's check needed.
	ClaimsChecked bool
}

// Rule is an auto-publish rule: on, its platform and pillar ("" = any), and
// whether the owners who made and switched it on are still active owners.
type Rule struct {
	Enabled      bool
	Platform     string
	Pillar       string
	OwnersActive bool
}

// HasApprovalOf: an owner approved exactly this version.
func HasApprovalOf(d Draft, version int) bool {
	return d.ApprovedByUserID != nil && d.ApprovedVersion != nil && *d.ApprovedVersion == version
}

// RuleApplies: on, the same platform, and its pillar any or exactly the draft's.
func RuleApplies(r *Rule, d Draft) bool {
	return r != nil && r.Enabled && r.Platform == d.Platform && (r.Pillar == "" || r.Pillar == d.Pillar)
}

// ScheduleInput is what deciding a schedule reads (the draft's row locked).
type ScheduleInput struct {
	ShownVersion        int
	WithoutApproval     bool
	Draft               Draft
	ApproverActiveOwner bool
	Rule                *Rule
	PickedAccounts      []string
	// The picked accounts found among the company's connections: platform and status.
	Accounts         map[string][2]string
	AccountsWithLive []string
	Blocked          bool
}

var withApproval = map[string]bool{"approved": true, "scheduled": true, "published": true, "failed": true}
var underARule = map[string]bool{"draft": true, "scheduled": true, "published": true, "failed": true}

// DecideSchedule says "owner" or "auto_rule", or a refusal: the draft first,
// then who stands behind it, the accounts, then the content.
func DecideSchedule(in ScheduleInput) (mode, refusal string) {
	d := in.Draft
	switch {
	case d.Version != in.ShownVersion:
		return "", "stale"
	case !underARule[d.Status] && !withApproval[d.Status]:
		return "", "wrong-status"
	case !publishes(d.Platform, d.Format):
		return "", "format-not-published"
	}
	switch {
	case HasApprovalOf(d, d.Version) && withApproval[d.Status]:
		if !in.ApproverActiveOwner {
			return "", "approver-gone"
		}
		mode = "owner"
	case !in.WithoutApproval:
		return "", "not-approved"
	case !underARule[d.Status]:
		return "", "wrong-status"
	case !RuleApplies(in.Rule, d):
		return "", "no-rule"
	case !in.Rule.OwnersActive:
		return "", "rule-owner-gone"
	default:
		mode = "auto_rule"
	}
	if len(in.PickedAccounts) == 0 {
		return "", "account-not-connected"
	}
	for _, id := range in.PickedAccounts {
		account, found := in.Accounts[id]
		if !found || account[1] != "connected" || account[0] != d.Platform {
			return "", "account-not-connected"
		}
	}
	switch {
	case len(in.AccountsWithLive) > 0:
		return "", "already-scheduled"
	case in.Blocked:
		return "", "blocked"
	case mode == "auto_rule" && !d.ClaimsChecked:
		return "", "claims-need-owner"
	}
	return mode, ""
}

// RunInput is the snapshot read right before sending.
type RunInput struct {
	ApprovalMode        string
	ApprovedVersion     int
	Draft               Draft
	ApproverActiveOwner bool
	Rule                *Rule
	// "" = not an account of this company.
	AccountPlatform, AccountStatus string
	Blocked                        bool
}

// ReasonNotToPublish is why the job may not go out now (a code), or "".
func ReasonNotToPublish(in RunInput) string {
	d := in.Draft
	switch {
	case d.Status == "archived":
		return "draft_archived"
	case d.Status == "rejected":
		return "draft_rejected"
	case d.Version != in.ApprovedVersion:
		return "draft_changed"
	case d.Status != "scheduled" && d.Status != "approved":
		return "approval_no_longer_valid"
	case !publishes(d.Platform, d.Format):
		return "format_not_published"
	}
	if in.ApprovalMode == "owner" {
		if !HasApprovalOf(d, in.ApprovedVersion) {
			return "approval_no_longer_valid"
		}
		if !in.ApproverActiveOwner {
			return "approver_not_owner"
		}
	} else if !RuleApplies(in.Rule, d) {
		return "rule_disabled"
	} else if !in.Rule.OwnersActive {
		return "rule_owner_gone"
	}
	switch {
	case in.AccountPlatform == "" || in.AccountStatus == "disconnected":
		return "account_disconnected"
	case in.AccountStatus == "needs_reauth":
		return "account_needs_reconnect"
	case in.AccountPlatform != d.Platform:
		return "wrong_account"
	case in.Blocked:
		return "draft_has_problems"
	case in.ApprovalMode == "auto_rule" && !d.ClaimsChecked:
		return "claims_not_checked"
	}
	return ""
}
