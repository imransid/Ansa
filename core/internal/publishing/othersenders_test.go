package publishing

import (
	"context"
	"testing"

	"ansa/core/internal/tenant"
)

// LinkedIn, X and YouTube plug in through OtherSenders (main.go wires their
// connectors there): the claim takes their posts once a sender exists.
func TestAnXPostGoesOutThroughItsSender(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	var accountID string
	const insert = `INSERT INTO social_connections (company_id, platform, external_account_id, display_name, account_kind, access_token_encrypted, connected_by_user_id)
		VALUES ($1, 'x', '42', '@ansa_bakery', 'account', 'placeholder', $2) RETURNING id`
	if err := w.pool.QueryRow(ctx, insert, w.company.String(), w.owner).Scan(&accountID); err != nil {
		t.Fatalf("account: %v", err)
	}
	draftID := w.draft(t, "x", "post", "Fresh bread at 7")
	w.approve(t, draftID, w.owner)
	jobIDs := w.schedule(t, draftID, []string{accountID}, nil)
	if handled, _ := w.runner.RunDue(ctx, w.company.String()); handled != 0 {
		t.Fatal("without an X sender, core doesn't claim X posts")
	}
	var sent []string
	w.runner.OtherSenders = map[string]*Sender{"x": {
		SetUp: true,
		Ready: func(_ context.Context, company tenant.CompanyID, connectionID string) (*ReadyAccount, error) {
			if company != w.company || connectionID != accountID {
				t.Errorf("readied another account: %s %s", company, connectionID)
			}
			return &ReadyAccount{ExternalID: "42", Token: "x-token", StoredToken: "sealed"}, nil
		},
		Publish: func(_ context.Context, account *ReadyAccount, post OutgoingPost) PostResult {
			sent = append(sent, account.ExternalID+"|"+account.Token+"|"+post.Text)
			return PostResult{Kind: "published", PostID: "1850", URL: "https://x.com/ansa_bakery/status/1850"}
		},
	}}
	if handled, err := w.runner.RunDue(ctx, w.company.String()); err != nil || handled != 1 {
		t.Fatalf("run: %d %v", handled, err)
	}
	if len(sent) != 1 || sent[0] != "42|x-token|Fresh bread at 7" {
		t.Fatalf("sent: %v", sent)
	}
	if status, _, _ := w.jobState(t, jobIDs[0]); status != "published" || w.field(t, jobIDs[0], "external_post_id") != "1850" || w.draftStatus(t, draftID) != "published" {
		t.Fatalf("published: %s", status)
	}
}
