package social

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/platforms"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// Getting a connection ready before any call to its platform (the old
// services/social-tokens.ts prepareConnectionForUse): its token decrypted,
// and renewed first when it runs out within 5 minutes, by one run at a
// time (the renewal is claimed in the database first; another run waits
// for its new tokens), the new tokens saved in one UPDATE. A refusal to
// renew marks it "needs reconnecting" with a code; a platform that didn't
// answer leaves it usable and notes the code. The token only ever goes to
// the platform's own connector.

const (
	// A token is renewed when it runs out within this time, so it never runs
	// out halfway through a publish (X's last two hours, Google's one).
	renewalMargin = 5 * time.Minute
	// While another run renews the tokens: how long to wait before looking
	// again, and how many looks in all, more than one renewal may take.
	renewalWait = time.Second
	mostLooks   = 20
)

// LongestPreparation is the longest Prepare can take: every look but one
// waiting for another run's renewal, and one renewal of its own. The
// publishing queue counts it in a run's time budget.
const LongestPreparation = (mostLooks-1)*renewalWait + platforms.APITimeout

// Renewer gets connections ready. Make one at start.
type Renewer struct {
	Pool      *database.Pool
	Box       *secure.Box
	Platforms *platforms.Connectors
	// How a run waits for another run's renewal: nil = a real pause. Tests
	// replace it so they don't wait.
	Wait func(ctx context.Context, d time.Duration) error
	// The clock: nil = time.Now.
	Now func() time.Time
}

// Prepared is one connection ready for one platform call, or why not.
type Prepared struct {
	// "ready"; "needs_reauth" (only an owner connecting again helps);
	// "unavailable" (no usable token now: try later, nothing for an owner
	// to do); "disconnected"; "not_found".
	Kind string
	// Why it isn't ready: token_expired, refresh_expired, refresh_refused,
	// token_rejected (needs_reauth); refresh_unavailable, not_set_up,
	// token_unreadable (unavailable).
	Code                 string
	Platform, ExternalID string
	IsStandIn            bool
	// The token that works now, and the access token as stored when it was
	// read: a later write about it (the platform refused it) changes the
	// connection only while it still holds that one.
	Token, StoredToken string
}

// Target is who posts, for a platform connector.
func (p Prepared) Target() platforms.Target {
	return platforms.Target{ExternalID: p.ExternalID, Token: p.Token}
}

// Prepare gets one of the company's connections (any platform, Facebook
// Pages too) ready for one platform call. The ONE function the publishing
// queue and the metrics collector call before a platform.
func (r *Renewer) Prepare(ctx context.Context, company tenant.CompanyID, connectionID string) (Prepared, error) {
	// WHY more than one look: when the stored tokens changed while this run
	// renewed them (another run renewed them first, or an owner
	// reconnected), the save matched nothing, and what is stored now is used
	// instead; and a run that finds another one renewing waits for its new
	// tokens. Each look reads the clock again.
	for look := 0; look < mostLooks; look++ {
		prepared, err := r.prepareOnce(ctx, company, connectionID)
		switch {
		case err != nil:
			return Prepared{}, err
		case prepared.Kind == "wait":
			if err := r.wait(ctx); err != nil {
				return Prepared{}, err
			}
		case prepared.Kind != "changed":
			return prepared, nil
		}
	}
	return Prepared{Kind: "unavailable", Code: "refresh_unavailable"}, nil
}

func (r *Renewer) wait(ctx context.Context) error {
	if r.Wait != nil {
		return r.Wait(ctx, renewalWait)
	}
	timer := time.NewTimer(renewalWait)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// prepareOnce is one look at the stored connection: its token, renewed
// when it runs out soon. Kind "wait": another run is renewing it;
// "changed": the stored tokens changed meanwhile, look again.
func (r *Renewer) prepareOnce(ctx context.Context, company tenant.CompanyID, connectionID string) (Prepared, error) {
	stored, err := readStoredConnection(ctx, r.Pool, company, connectionID)
	switch {
	case err != nil:
		return Prepared{}, err
	case stored == nil:
		return Prepared{Kind: "not_found"}, nil
	case stored.status == "disconnected" || stored.accessEncrypted == nil:
		return Prepared{Kind: "disconnected"}, nil
	case stored.status == "needs_reauth":
		code := "token_rejected"
		if stored.lastError != nil {
			code = *stored.lastError
		}
		return Prepared{Kind: "needs_reauth", Code: code}, nil
	}
	// The stored id, as Postgres gives it back: the tokens were encrypted for it.
	accessToken, accessErr := r.Box.Decrypt(*stored.accessEncrypted, TokenContext(company, stored.id, "access"))
	refreshToken := ""
	var refreshErr error
	if stored.refreshEncrypted != nil {
		refreshToken, refreshErr = r.Box.Decrypt(*stored.refreshEncrypted, TokenContext(company, stored.id, "refresh"))
	}
	if accessErr != nil || accessToken == "" || refreshErr != nil {
		// A wrong DATA_ENCRYPTION_KEY: nothing is marked on the connection,
		// since the key is the fix, not a reconnect.
		return Prepared{Kind: "unavailable", Code: "token_unreadable"}, nil
	}
	ready := Prepared{Kind: "ready", Platform: stored.platform, ExternalID: stored.externalID, IsStandIn: stored.isStandIn,
		Token: accessToken, StoredToken: *stored.accessEncrypted}
	switch r.whatToDo(stored, refreshToken != "") {
	case "use":
		return ready, nil
	case "renew":
		return r.renew(ctx, company, stored, ready, refreshToken)
	case "not_set_up":
		// This server's matter, not the connection's: nothing is noted on it.
		return Prepared{Kind: "unavailable", Code: "not_set_up"}, nil
	case "token_expired":
		return r.markOrLookAgain(ctx, company, stored, "token_expired")
	}
	return r.markOrLookAgain(ctx, company, stored, "refresh_expired")
}

// whatToDo decides from the lifetimes (the old refreshIfNeeded): "use"
// the token as it is; "renew" it (X, Google; LinkedIn for its partners);
// "token_expired" or "refresh_expired" (nothing can renew it: a reconnect);
// "not_set_up" (this server has no app to renew it with). Facebook Page
// tokens and the stand-in's never run out.
func (r *Renewer) whatToDo(stored *storedConnection, hasRefreshToken bool) string {
	now := r.now()
	expires := stored.accessExpiresAt
	switch {
	case stored.isStandIn || expires == nil || expires.Sub(now) > renewalMargin:
		return "use"
	case !hasRefreshToken && expires.After(now):
		// Without a way to renew it, it works until the moment it runs out.
		return "use"
	case !hasRefreshToken:
		return "token_expired"
	case stored.refreshExpiresAt != nil && !stored.refreshExpiresAt.After(now):
		return "refresh_expired"
	case r.Platforms.Mode(stored.platform) != "real":
		return "not_set_up"
	}
	return "renew"
}

func (r *Renewer) now() time.Time {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now()
}
