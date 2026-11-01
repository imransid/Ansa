package socialconnect

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestTheAccountsPageShowsEachAccessAsOfNowAndNoToken(t *testing.T) {
	c, company, owner := newConnector(t)
	f := &fakePlatform{}
	withPlatforms(c, f)
	ctx := context.Background()
	for _, platform := range []string{"linkedin", "x", "youtube"} {
		connectFully(t, c, company, owner, platform, f)
	}
	set := func(platform, columns string) {
		if _, err := c.Pool.Exec(ctx, `UPDATE social_connections SET `+columns+` WHERE company_id = $1 AND platform = $2`, company.String(), platform); err != nil {
			t.Fatalf("setup: %v", err)
		}
	}
	page, err := c.AccountsPage(ctx, company, true)
	if err != nil || !page.CanManage || page.ShowsOperatorNotes || len(page.Platforms) != 4 {
		t.Fatalf("the page: %v %+v", err, page)
	}
	byPlatform := map[string]PlatformView{}
	for _, view := range page.Platforms {
		byPlatform[view.Platform] = view
	}
	linkedIn, x, youTube := byPlatform["linkedin"], byPlatform["x"], byPlatform["youtube"]
	check(t, "what each takes", []string{linkedIn.Publishes, youTube.Publishes, linkedIn.TextLimit, x.TextLimit, youTube.TextLimit}, []string{
		"Text posts and posts with an image", "Videos only", "Post text: up to 3,000 characters.", "Post text: up to 280 characters as X counts them.",
		"Title: up to 100 characters. Description: up to 5,000 bytes."})
	check(t, "modes and revokes", []any{linkedIn.Mode, byPlatform["facebook"].Mode, linkedIn.RevokesOnRequest, x.RevokesOnRequest, linkedIn.MissingSettings == nil},
		[]any{"real", "real", false, true, true})
	check(t, "a member's 60 days", []any{linkedIn.Connections[0].Status, linkedIn.Connections[0].Lifetime.Kind}, []any{"connected", "runs-out"})
	check(t, "Google's refresh token", []any{youTube.Connections[0].Lifetime.Kind, youTube.Connections[0].Lifetime.Until != nil}, []any{"renews-itself", true})
	// Past their ends with nothing to renew them: needing a reconnect before anything tried.
	set("linkedin", `access_expires_at = now() - interval '1 day', connected_at = now() - interval '61 days'`)
	set("youtube", `access_expires_at = now() - interval '1 hour', refresh_expires_at = now() - interval '1 minute'`)
	set("x", `status = 'needs_reauth', last_error = 'token_rejected'`)
	page, _ = c.AccountsPage(ctx, company, false)
	for _, view := range page.Platforms {
		byPlatform[view.Platform] = view
	}
	shownLinkedIn, shownYouTube, shownX := byPlatform["linkedin"].Connections[0], byPlatform["youtube"].Connections[0], byPlatform["x"].Connections[0]
	check(t, "LinkedIn ran out", []any{shownLinkedIn.Status, *shownLinkedIn.ProblemCode, shownLinkedIn.Lifetime.Kind}, []any{"needs_reauth", "token_expired", "ran-out"})
	if !strings.Contains(*shownLinkedIn.Problem, "permission ran out (it lasts 60 days") {
		t.Fatalf("the words: %s", *shownLinkedIn.Problem)
	}
	check(t, "YouTube's refresh token ran out", []any{shownYouTube.Status, *shownYouTube.ProblemCode, shownYouTube.Lifetime.Kind}, []any{"needs_reauth", "refresh_expired", "ran-out"})
	check(t, "X refused its token, its end still ahead", []any{shownX.Status, *shownX.Problem, shownX.Lifetime.Kind},
		[]any{"needs_reauth", "X refused ansa's permission the last time it was used. Reconnect to keep posting.", "none"})
	check(t, "a member reads, without the buttons", page.CanManage, false)
	encoded, _ := json.Marshal(page)
	for _, secret := range []string{"li-access", "x-access", "x-refresh", "yt-access", "yt-refresh", "secret-x", "v1:", "the-code"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatalf("the page's data holds %s", secret)
		}
	}
	var id string
	c.Pool.QueryRow(ctx, `SELECT id FROM social_connections WHERE company_id = $1 AND platform = 'x'`, company.String()).Scan(&id)
	Disconnect(ctx, c.Pool, company, owner, id)
	page, _ = c.AccountsPage(ctx, company, true)
	for _, view := range page.Platforms {
		byPlatform[view.Platform] = view
	}
	check(t, "disconnected ones apart", []int{len(byPlatform["x"].Connections), len(byPlatform["x"].Disconnected)}, []int{0, 1})
}

func TestTheAccountsPageNamesMissingSettingsOnlyInDevelopment(t *testing.T) {
	c, company, _ := newConnector(t)
	c.AppID, c.AppSecret, c.Development = "", "", true
	page, _ := c.AccountsPage(context.Background(), company, true)
	view := page.Platforms[2]
	check(t, "development names X's settings", []any{page.ShowsOperatorNotes, view.Platform, view.Mode, view.MissingSettings.ID, view.MissingSettings.Secret},
		[]any{true, "x", "stand-in", "X_CLIENT_ID", "X_CLIENT_SECRET"})
	c.Development = false
	page, _ = c.AccountsPage(context.Background(), company, true)
	check(t, "production names none", []any{page.Platforms[2].Mode, page.Platforms[2].MissingSettings == nil, page.ShowsOperatorNotes}, []any{"not-set-up", true, false})
}
