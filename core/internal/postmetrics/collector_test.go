package postmetrics

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/messenger"
	"ansa/core/internal/secure"
	"ansa/core/internal/social"
	"ansa/core/internal/tenant"
)

func seven() *int64 { n := int64(7); return &n }

func TestAPublishedPostsNumbersAreReadOnceADayAndKept(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	owner := database.TestOwner(t, pool, companyID)
	ctx := context.Background()
	box, _ := secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	var pageID, draftID, jobID string
	pool.QueryRow(ctx, `INSERT INTO social_connections (company_id, platform, external_account_id, display_name, account_kind, access_token_encrypted, connected_by_user_id)
		VALUES ($1, 'facebook', '111', 'Page', 'page', 'placeholder', $2) RETURNING id`, companyID, owner).Scan(&pageID)
	token, _ := box.Encrypt("page-token", social.TokenContext(company, pageID, "access"))
	pool.Exec(ctx, `UPDATE social_connections SET access_token_encrypted = $3 WHERE company_id = $1 AND id = $2`, companyID, pageID, token)
	pool.QueryRow(ctx, `INSERT INTO content_drafts (company_id, platform, format, topic, body, status, created_by_user_id, updated_by_user_id)
		VALUES ($1, 'facebook', 'post', 'Pizza', 'Pizza night', 'published', $2, $2) RETURNING id`, companyID, owner).Scan(&draftID)
	pool.QueryRow(ctx, `INSERT INTO publish_jobs (company_id, draft_id, connection_id, scheduled_for, run_after, status, approval_mode, approved_version, created_by_user_id, attempts, published_at, external_post_id)
		VALUES ($1, $2, $3, now(), now(), 'published', 'owner', 1, $4, 1, now() - interval '2 hours', '111_222') RETURNING id`, companyID, draftID, pageID, owner).Scan(&jobID)
	var asked []string
	collector := &Collector{Pool: pool, Box: box, Log: logging.New(io.Discard), FacebookAppSecret: "app-secret",
		ReadFacebook: func(_ context.Context, _, postID, pageToken string) (Numbers, string) {
			asked = append(asked, postID+"|"+pageToken)
			return Numbers{Reactions: seven(), Comments: seven()}, ""
		}}
	if read, err := collector.RunDue(ctx, companyID); err != nil || read != 1 || len(asked) != 1 || asked[0] != "111_222|page-token" {
		t.Fatalf("read: %d %v %v", read, err, asked)
	}
	var reactions, shares *int64
	pool.QueryRow(ctx, `SELECT reactions, shares FROM post_metrics WHERE company_id = $1 AND publish_job_id = $2`, companyID, jobID).Scan(&reactions, &shares)
	if reactions == nil || *reactions != 7 || shares != nil {
		t.Fatal("the numbers given, and NULL (never 0) for the one not given")
	}
	if read, _ := collector.RunDue(ctx, companyID); read != 0 {
		t.Fatal("read once a day")
	}
	pool.Exec(ctx, `UPDATE publish_jobs SET metrics_attempted_at = now() - interval '21 hours' WHERE company_id = $1`, companyID)
	collector.ReadFacebook = func(context.Context, string, string, string) (Numbers, string) { return Numbers{}, "token_rejected" }
	collector.RunDue(ctx, companyID)
	var code, status string
	pool.QueryRow(ctx, `SELECT metrics_error FROM publish_jobs WHERE company_id = $1 AND id = $2`, companyID, jobID).Scan(&code)
	pool.QueryRow(ctx, `SELECT status FROM social_connections WHERE company_id = $1 AND id = $2`, companyID, pageID).Scan(&status)
	var snapshots int
	pool.QueryRow(ctx, `SELECT count(*) FROM post_metrics WHERE company_id = $1`, companyID).Scan(&snapshots)
	if code != "token_rejected" || status != "needs_reauth" || snapshots != 1 {
		t.Fatalf("a refused token: %s, page %s, %d snapshots", code, status, snapshots)
	}
}

func TestFacebooksAnswerIsReadForItsNumbersOnly(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/1_2":
			io.WriteString(w, `{"shares":{"count":3},"reactions":{"data":[],"summary":{"total_count":12}},"comments":{"summary":{"total_count":4}},"id":"1_2"}`)
		case "/1_3":
			io.WriteString(w, `{"id":"1_3"}`)
		default:
			w.WriteHeader(http.StatusBadRequest)
			io.WriteString(w, `{"error":{"code":190,"message":"never read"}}`)
		}
	}))
	defer server.Close()
	before := messenger.GraphURL
	messenger.GraphURL = server.URL
	defer func() { messenger.GraphURL = before }()
	numbers, failure := ReadFacebook(context.Background(), "secret", "1_2", "token")
	if failure != "" || *numbers.Reactions != 12 || *numbers.Comments != 4 || *numbers.Shares != 3 {
		t.Fatalf("numbers: %+v %s", numbers, failure)
	}
	if _, failure := ReadFacebook(context.Background(), "secret", "1_3", "token"); failure != "no_numbers" {
		t.Fatalf("an answer without a number: %s", failure)
	}
	if _, failure := ReadFacebook(context.Background(), "secret", "1_4", "token"); failure != "token_rejected" {
		t.Fatalf("a refused token: %s", failure)
	}
	if _, failure := ReadFacebook(context.Background(), "secret", "../me", "token"); failure != "invalid_request" {
		t.Fatal("only a post id is asked for")
	}
}
