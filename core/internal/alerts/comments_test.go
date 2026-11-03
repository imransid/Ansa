package alerts

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ansa/core/internal/comments"
	"ansa/core/internal/database"
	"ansa/core/internal/email"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/tenant"
)

// A comment that needs a person: the owners are told who, why, what reached
// the commenter and where to look (the request, until a Messenger
// conversation exists), never the comment.
func TestACommentAlertSaysWhoWhyAndWhereNeverTheComment(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	ctx := context.Background()
	owner := database.TestOwner(t, pool, companyID)
	var connection, ticket, commentID string
	pool.QueryRow(ctx, `INSERT INTO social_connections (company_id, platform, external_account_id, display_name, account_kind, access_token_encrypted, connected_by_user_id, is_stand_in)
		VALUES ($1, 'facebook', 'dev:stand-in', 'Page', 'page', 'v1:x:y:z', $2, true) RETURNING id`, companyID, owner).Scan(&connection)
	pool.QueryRow(ctx, `INSERT INTO tickets (company_id, ticket_number, subject, description, channel) VALUES ($1, 9, 'Cold food', 'x', 'chat') RETURNING id`, companyID).Scan(&ticket)
	err := pool.QueryRow(ctx, `INSERT INTO page_comments (company_id, connection_id, page_id, post_id, comment_id, commenter_id, commenter_name, text_encrypted, commented_at,
			status, kind, decided_at, public_reply_encrypted, public_reply_status, private_message_encrypted, private_message_status, private_message_error, ticket_id)
		VALUES ($1, $2, 'dev:stand-in', 'p', 'c', 'sara', 'Sara', 'v1:secret:secret:secret', now(), 'answered', 'complaint', now(), 'v1:x:y:z', 'sent', 'v1:x:y:z', 'failed', 'cannot_reply', $3)
		RETURNING id`, companyID, connection, ticket).Scan(&commentID)
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	folder := t.TempDir()
	limiter := ratelimit.New(pool, "core-test-secret")
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM rate_limits WHERE key = $1`, limiter.Key("owner-alerts", companyID))
	})
	alerter := &Alerter{Pool: pool, Limiter: limiter, Email: &email.Sender{DevFolder: folder}, AppURL: "http://localhost:3000", Log: logging.New(io.Discard)}
	payload, _ := json.Marshal(comments.AlertPayload{CommentID: commentID, Reason: "complaint"})
	if err := alerter.HandleCommentJob(ctx, &jobs.Job{ID: "j1", CompanyID: company, Kind: comments.AlertJobKind, Payload: payload}); err != nil {
		t.Fatalf("HandleCommentJob: %v", err)
	}
	files, _ := os.ReadDir(filepath.Join(folder, ".dev-emails"))
	if len(files) != 1 {
		t.Fatalf("%d emails", len(files))
	}
	page, _ := os.ReadFile(filepath.Join(folder, ".dev-emails", files[0].Name()))
	for _, want := range []string{"Sara needs you about a comment on your Facebook post. They complained.", "ansa replied under the comment.", "/tickets/9"} {
		if !strings.Contains(string(page), want) {
			t.Fatalf("the email lacks %q", want)
		}
	}
	if strings.Contains(string(page), "secret") {
		t.Fatal("never the comment")
	}
	other, _ := tenant.FromTrustedSource(database.TestCompany(t, pool))
	if err := alerter.HandleCommentJob(ctx, &jobs.Job{ID: "j2", CompanyID: other, Payload: payload}); err == nil {
		t.Fatal("another company's job finds no comment")
	}
}
