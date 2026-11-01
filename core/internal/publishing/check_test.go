package publishing

import "testing"

func TestTheRulesDecideWhenAPostRuns(t *testing.T) {
	rule := &Rule{Enabled: true, Platform: "facebook", Pillar: "", OwnersActive: true}
	draft := Draft{Platform: "facebook", Format: "post", Status: "scheduled", Version: 1, ClaimsChecked: true}
	in := RunInput{ApprovalMode: "auto_rule", ApprovedVersion: 1, Draft: draft, Rule: rule, AccountPlatform: "facebook", AccountStatus: "connected"}
	if got := ReasonNotToPublish(in); got != "" {
		t.Fatalf("may go: %s", got)
	}
	cases := map[string]func(*RunInput){
		"draft_changed":           func(i *RunInput) { i.Draft.Version = 2 },
		"rule_disabled":           func(i *RunInput) { i.Rule = &Rule{Platform: "facebook"} },
		"rule_owner_gone":         func(i *RunInput) { i.Rule = &Rule{Enabled: true, Platform: "facebook", OwnersActive: false} },
		"account_needs_reconnect": func(i *RunInput) { i.AccountStatus = "needs_reauth" },
		"draft_has_problems":      func(i *RunInput) { i.Blocked = true },
		"claims_not_checked":      func(i *RunInput) { i.Draft.ClaimsChecked = false },
		"approver_not_owner": func(i *RunInput) {
			owner, one := "u1", 1
			i.ApprovalMode, i.Draft.ApprovedByUserID, i.Draft.ApprovedVersion = "owner", &owner, &one
		},
	}
	for want, change := range cases {
		copy := in
		change(&copy)
		if got := ReasonNotToPublish(copy); got != want {
			t.Errorf("%s: got %q", want, got)
		}
	}
}

func TestSchedulingUnderARule(t *testing.T) {
	in := ScheduleInput{ShownVersion: 1, WithoutApproval: true, Draft: Draft{Platform: "facebook", Format: "post", Status: "draft", Version: 1, ClaimsChecked: true},
		Rule: &Rule{Enabled: true, Platform: "facebook", OwnersActive: true}, PickedAccounts: []string{"p1"}, Accounts: map[string][2]string{"p1": {"facebook", "connected"}}}
	if mode, refusal := DecideSchedule(in); mode != "auto_rule" || refusal != "" {
		t.Fatalf("under the rule: %s %s", mode, refusal)
	}
	in.WithoutApproval = false
	if _, refusal := DecideSchedule(in); refusal != "not-approved" {
		t.Fatal("without the owner's tick a draft needs its approval")
	}
}
