package postmetrics

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/platforms"
	"ansa/core/internal/secure"
	"ansa/core/internal/social"
	"ansa/core/internal/tenant"
)

// fakeYouTube answers a video's statistics, and counts what it was asked.
type fakeYouTube struct{ asked []string }

func (f *fakeYouTube) RoundTrip(r *http.Request) (*http.Response, error) {
	f.asked = append(f.asked, r.URL.Host+r.URL.Path+"?"+r.URL.RawQuery+"|"+r.Header.Get("Authorization"))
	body := `{"items":[{"statistics":{"viewCount":"120","likeCount":"8","commentCount":"2"}}]}`
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}, nil
}

func TestAYouTubeVideosNumbersAreReadThroughItsConnector(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	owner := database.TestOwner(t, pool, companyID)
	ctx := context.Background()
	box, _ := secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	var channelID, draftID, jobID string
	pool.QueryRow(ctx, `INSERT INTO social_connections (company_id, platform, external_account_id, display_name, account_kind, access_token_encrypted, access_expires_at, connected_by_user_id)
		VALUES ($1, 'youtube', 'UC123', 'Channel', 'channel', 'placeholder', now() + interval '1 hour', $2) RETURNING id`, companyID, owner).Scan(&channelID)
	token, _ := box.Encrypt("channel-token", social.TokenContext(company, channelID, "access"))
	pool.Exec(ctx, `UPDATE social_connections SET access_token_encrypted = $3 WHERE company_id = $1 AND id = $2`, companyID, channelID, token)
	pool.QueryRow(ctx, `INSERT INTO content_drafts (company_id, platform, format, topic, title, body, status, created_by_user_id, updated_by_user_id)
		VALUES ($1, 'youtube', 'video', 'Kitchen tour', 'Our kitchen', 'A tour', 'published', $2, $2) RETURNING id`, companyID, owner).Scan(&draftID)
	pool.QueryRow(ctx, `INSERT INTO publish_jobs (company_id, draft_id, connection_id, scheduled_for, run_after, status, approval_mode, approved_version, created_by_user_id, attempts, published_at, external_post_id)
		VALUES ($1, $2, $3, now(), now(), 'published', 'owner', 1, $4, 1, now() - interval '2 hours', 'vid_ABC123') RETURNING id`, companyID, draftID, channelID, owner).Scan(&jobID)
	youtube := &fakeYouTube{}
	connectors := &platforms.Connectors{Apps: map[string]platforms.App{"youtube": {ClientID: "id", ClientSecret: "secret"}}, Transport: youtube}
	collector := &Collector{Pool: pool, Box: box, Log: logging.New(io.Discard), Renewer: &social.Renewer{Pool: pool, Box: box, Platforms: connectors}, Platforms: connectors}
	if read, err := collector.RunDue(ctx, companyID); err != nil || read != 1 || len(youtube.asked) != 1 {
		t.Fatalf("read: %d %v %v", read, err, youtube.asked)
	}
	if !strings.Contains(youtube.asked[0], "id=vid_ABC123") || !strings.HasSuffix(youtube.asked[0], "|Bearer channel-token") {
		t.Fatalf("asked YouTube for that video with the channel's token: %s", youtube.asked[0])
	}
	var views, reactions, comments, shares *int64
	pool.QueryRow(ctx, `SELECT views, reactions, comments, shares FROM post_metrics WHERE company_id = $1 AND publish_job_id = $2`, companyID, jobID).Scan(&views, &reactions, &comments, &shares)
	if views == nil || *views != 120 || reactions == nil || *reactions != 8 || comments == nil || *comments != 2 || shares != nil {
		t.Fatal("YouTube's views, likes and comments kept, and NULL (never 0) for its shares")
	}
	// A LinkedIn post is never asked (its numbers need a permission ansa's app can't have).
	pool.Exec(ctx, `UPDATE social_connections SET platform = 'linkedin', account_kind = 'member' WHERE company_id = $1 AND id = $2`, companyID, channelID)
	pool.Exec(ctx, `UPDATE publish_jobs SET metrics_attempted_at = now() - interval '21 hours' WHERE company_id = $1`, companyID)
	if read, _ := collector.RunDue(ctx, companyID); read != 0 || len(youtube.asked) != 1 {
		t.Fatal("LinkedIn is never asked")
	}
}
