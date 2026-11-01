package social

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestATokenRunningOutIsRenewedAndSavedAndAFreshOneIsUsedAsItIs(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	x := fake(renewedTo("new"))
	id := w.connect("x", "1234567890", time.Minute, true)
	prepared, err := w.renewer(x).Prepare(ctx, w.company, id)
	if err != nil || prepared.Kind != "ready" || prepared.Token != "new-access" || prepared.Target().ExternalID != "1234567890" {
		t.Fatalf("renewed: %+v %v", prepared, err)
	}
	stored := w.row(id)
	check(t, "saved in one update, X's new refresh token kept", []any{stored.status, stored.access, stored.refresh, stored.lastError, stored.renewalClaimed},
		[]any{"connected", "new-access", "new-refresh", "", false})
	if stored.accessExpiresAt == nil || time.Until(*stored.accessExpiresAt) < 119*time.Minute {
		t.Fatalf("two hours from now: %v", stored.accessExpiresAt)
	}
	if !strings.HasPrefix(prepared.StoredToken, "v1:") || strings.Contains(prepared.StoredToken, "new-access") {
		t.Fatal("the stored token is the encrypted one")
	}
	fresh := fake()
	plenty := w.connect("x", "222", time.Hour, true)
	if prepared, _ := w.renewer(fresh).Prepare(ctx, w.company, plenty); prepared.Kind != "ready" || prepared.Token != "x-access" || fresh.count() != 0 {
		t.Fatalf("a token with an hour left is used as it is, X not asked: %+v", prepared)
	}
}

func TestARefusedRenewalNeedsAReconnectAndASilentPlatformLeavesItUsable(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	id := w.connect("youtube", "UCchannel", time.Minute, true)
	silent, _ := w.renewer(fake(reply(503, ""))).Prepare(ctx, w.company, id)
	check(t, "no answer", []string{silent.Kind, silent.Code}, []string{"unavailable", "refresh_unavailable"})
	stored := w.row(id)
	check(t, "still connected, the code noted, the claim ended", []any{stored.status, stored.lastError, stored.renewalClaimed}, []any{"connected", "refresh_unavailable", false})
	if renewed, _ := w.renewer(fake(reply(200, `{"access_token":"yt-access-2","expires_in":3599}`))).Prepare(ctx, w.company, id); renewed.Kind != "ready" {
		t.Fatalf("renewed next time: %+v", renewed)
	}
	stored = w.row(id)
	check(t, "the code cleared, Google's refresh token kept", []string{stored.lastError, stored.refresh}, []string{"", "youtube-refresh"})
	w.must(`UPDATE social_connections SET access_expires_at = now() + interval '2 minutes' WHERE company_id = $1 AND id = $2`, w.company.String(), id)
	refused, _ := w.renewer(fake(reply(400, `{"error":"invalid_grant"}`))).Prepare(ctx, w.company, id)
	check(t, "refused", []string{refused.Kind, refused.Code}, []string{"needs_reauth", "refresh_refused"})
	stored = w.row(id)
	check(t, "marked, its tokens kept for the revoke", []any{stored.status, stored.lastError, stored.access != ""}, []any{"needs_reauth", "refresh_refused", true})
	var logged int
	w.pool.QueryRow(ctx, `SELECT count(*) FROM cofounder_activity WHERE company_id = $1 AND action = 'reconnect_needed' AND connection_id = $2 AND code = 'refresh_refused' AND actor_user_id IS NULL`,
		w.company.String(), id).Scan(&logged)
	check(t, "the activity log", logged, 1)
	nobody := fake()
	again, _ := w.renewer(nobody).Prepare(ctx, w.company, id)
	check(t, "nobody asks Google again until a reconnect", []any{again.Kind, again.Code, nobody.count()}, []any{"needs_reauth", "refresh_refused", 0})
	other := w.connect("x", "333", time.Minute, true)
	noApp := w.renewer(nobody)
	noApp.Platforms.Apps = nil
	notSetUp, _ := noApp.Prepare(ctx, w.company, other)
	check(t, "a server without the app marks nothing", []any{notSetUp.Kind, notSetUp.Code, w.row(other).status, w.row(other).lastError}, []any{"unavailable", "not_set_up", "connected", ""})
}

func TestALinkedInTokenPastItsDaysNeedsAReconnectAndPagesAreUsedAsTheyAre(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	nobody := fake()
	linkedIn := w.connect("linkedin", "abc123", 3*time.Minute, false)
	if prepared, _ := w.renewer(nobody).Prepare(ctx, w.company, linkedIn); prepared.Kind != "ready" {
		t.Fatalf("within its last minutes it still works (LinkedIn can't renew it anyway): %+v", prepared)
	}
	w.must(`UPDATE social_connections SET access_expires_at = now() - interval '1 minute' WHERE company_id = $1 AND id = $2`, w.company.String(), linkedIn)
	expired, _ := w.renewer(nobody).Prepare(ctx, w.company, linkedIn)
	check(t, "past its 60 days", []string{expired.Kind, expired.Code, w.row(linkedIn).status, w.row(linkedIn).lastError}, []string{"needs_reauth", "token_expired", "needs_reauth", "token_expired"})
	page := w.connect("facebook", "555", 0, false)
	if prepared, _ := w.renewer(nobody).Prepare(ctx, w.company, page); prepared.Kind != "ready" || prepared.Token != "facebook-access" || prepared.Platform != "facebook" {
		t.Fatalf("a Page token never runs out: %+v", prepared)
	}
	standIn := w.connect("youtube", "dev:stand-in", 0, false)
	if prepared, _ := w.renewer(nobody).Prepare(ctx, w.company, standIn); prepared.Kind != "ready" || !prepared.IsStandIn {
		t.Fatalf("the stand-in: %+v", prepared)
	}
	check(t, "nobody asked", nobody.count(), 0)
	gone, _ := w.renewer(nobody).Prepare(ctx, w.company, "00000000-0000-4000-8000-000000000000")
	check(t, "another id", gone.Kind, "not_found")
}

func TestARenewalRacingADisconnectOrAnotherRenewalNeverWins(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	id := w.connect("x", "1234567890", time.Minute, true)
	// X answers only once the owner has disconnected meanwhile.
	slowX := fake(func(r *http.Request) (*http.Response, error) {
		w.must(`UPDATE social_connections SET status = 'disconnected', access_token_encrypted = NULL, refresh_token_encrypted = NULL,
			access_expires_at = NULL, refresh_expires_at = NULL, renewal_started_at = NULL, disconnected_at = now() WHERE company_id = $1 AND id = $2`, w.company.String(), id)
		return renewedTo("late")(r)
	})
	prepared, _ := w.renewer(slowX).Prepare(ctx, w.company, id)
	gone := w.row(id)
	check(t, "a disconnect is never undone", []string{prepared.Kind, gone.status, gone.access, gone.refresh}, []string{"disconnected", "disconnected", "", ""})
	// Two runs at once, as when one's claim looks over a minute old: the later save finds the other one's token, and uses it.
	other := w.connect("x", "444", time.Minute, true)
	secondX := fake(func(r *http.Request) (*http.Response, error) {
		w.must(`UPDATE social_connections SET renewal_started_at = now() - interval '2 minutes' WHERE company_id = $1 AND id = $2`, w.company.String(), other)
		first, _ := w.renewer(fake(renewedTo("first"))).Prepare(ctx, w.company, other)
		if first.Token != "first-access" {
			t.Errorf("the first run: %+v", first)
		}
		return renewedTo("second")(r)
	})
	second, _ := w.renewer(secondX).Prepare(ctx, w.company, other)
	check(t, "the newer token stands", []string{second.Token, w.row(other).access}, []string{"first-access", "first-access"})
}

func TestTwoRunsRenewingOneXTokenAtOnceAskXOnce(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	id := w.connect("x", "1234567890", time.Minute, true)
	xWasAsked, xMayAnswer := make(chan struct{}), make(chan struct{})
	// The second answer is what X says to a refresh token it already took.
	x := fake(func(r *http.Request) (*http.Response, error) {
		close(xWasAsked)
		<-xMayAnswer
		return renewedTo("first")(r)
	}, reply(400, `{"error":"invalid_request"}`))
	firstDone := make(chan Prepared)
	go func() {
		prepared, _ := w.renewer(x).Prepare(ctx, w.company, id)
		firstDone <- prepared
	}()
	<-xWasAsked
	var first Prepared
	waits := 0
	second := w.renewer(x)
	second.Wait = func(context.Context, time.Duration) error {
		waits++
		close(xMayAnswer)
		first = <-firstDone
		return nil
	}
	again, _ := second.Prepare(ctx, w.company, id)
	stored := w.row(id)
	check(t, "X asked once, both use its new token", []any{x.count(), first.Token, again.Token, waits}, []any{1, "first-access", "first-access", 1})
	check(t, "stored", []any{stored.status, stored.lastError, stored.renewalClaimed, stored.refresh}, []any{"connected", "", false, "first-refresh"})
}

func TestAClaimWithinItsMinuteIsWaitedForAndAnOlderOneIsTakenOver(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	id := w.connect("x", "1234567890", time.Minute, true)
	w.must(`UPDATE social_connections SET renewal_started_at = now() - interval '30 seconds' WHERE company_id = $1 AND id = $2`, w.company.String(), id)
	var waited time.Duration
	x := fake(renewedTo("taken-over"))
	patient := w.renewer(x)
	patient.Wait = func(_ context.Context, d time.Duration) error { waited += d; return nil }
	gaveUp, _ := patient.Prepare(ctx, w.company, id)
	check(t, "try again later", []any{gaveUp.Kind, gaveUp.Code, x.count(), waited > 15*time.Second}, []any{"unavailable", "refresh_unavailable", 0, true})
	check(t, "nothing marked", []string{w.row(id).status, w.row(id).lastError, w.row(id).access}, []string{"connected", "", "x-access"})
	w.must(`UPDATE social_connections SET renewal_started_at = now() - interval '61 seconds' WHERE company_id = $1 AND id = $2`, w.company.String(), id)
	renewed, _ := patient.Prepare(ctx, w.company, strings.ToUpper(id))
	check(t, "a dead run's claim is taken over (an id in capitals too)", []any{renewed.Token, w.row(id).renewalClaimed, w.row(id).access}, []any{"taken-over-access", false, "taken-over-access"})
	if again, _ := w.renewer(fake()).Prepare(ctx, w.company, strings.ToUpper(id)); again.Token != "taken-over-access" {
		t.Fatalf("read under the id Postgres gives back: %+v", again)
	}
}
