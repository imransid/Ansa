package publishing

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// postURLHosts are where each platform's posts live (the old
// lib/publishing/post-urls.ts). An owner who checked the platform may name
// the post's address when marking a post published; only https on these
// hosts is kept, so a link on the queue always opens the platform it
// names, never another site.
var postURLHosts = map[string][]string{
	"linkedin": {"linkedin.com", "www.linkedin.com"},
	"facebook": {"facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.com", "www.fb.com"},
	"x":        {"x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"},
	"youtube":  {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"},
}

// PostURLMax is the longest post address kept (a CHECK holds it too).
const PostURLMax = 2_000

// ReadPostURL is the address as it is stored, or "" when it isn't an https
// address on one of the platform's hosts (no user name, password or port).
func ReadPostURL(text, platform string) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" || utf8.RuneCountInString(trimmed) > PostURLMax {
		return ""
	}
	address, err := url.Parse(trimmed)
	if err != nil || address.Scheme != "https" || address.User != nil || address.Port() != "" || address.Opaque != "" {
		return ""
	}
	// As a browser reads it: "WWW.Facebook.com" is www.facebook.com.
	address.Host = strings.ToLower(address.Host)
	stored := address.String()
	for _, host := range postURLHosts[platform] {
		if address.Host == host && len(stored) <= PostURLMax {
			return stored
		}
	}
	return ""
}

// JobPlatform is the platform of one of the company's posts (its
// account's), for checking a post's address: "" when the company has no
// such post.
func JobPlatform(ctx context.Context, pool *database.Pool, company tenant.CompanyID, jobID string) (string, error) {
	const statement = `
		SELECT social_connections.platform FROM publish_jobs
		JOIN social_connections ON social_connections.company_id = publish_jobs.company_id AND social_connections.id = publish_jobs.connection_id
		WHERE publish_jobs.company_id = $1 AND publish_jobs.id::text = $2`
	var platform string
	err := pool.QueryRow(ctx, statement, company.String(), jobID).Scan(&platform)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return platform, err
}

// The window a scheduled time must fall in: not further back than a
// minute (filling in the form takes a moment), not more than a year ahead.
const (
	schedulePastGrace = time.Minute
	scheduleMaxAhead  = 365 * 24 * time.Hour
)

// CheckScheduleTime says whether a post may be scheduled for this moment:
// "ok", "past" or "too_far".
func CheckScheduleTime(at, now time.Time) string {
	if at.Before(now.Add(-schedulePastGrace)) {
		return "past"
	}
	if at.After(now.Add(scheduleMaxAhead)) {
		return "too_far"
	}
	return "ok"
}
