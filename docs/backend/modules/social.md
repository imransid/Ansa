# social (core/internal/social)

**What:** the ONLY code in core that decrypts a social account's token (the
old `services/social-tokens.ts` and the revoke of
`services/social-disconnect.ts`). A token is read right before a call to its
platform and goes only to that platform's connector. Stored encrypted with
the context `social-<kind>-token:<company>:<connection>`, as the old backend
wrote them; decrypted under the id Postgres gives back (an id written in
capitals finds its tokens). A test reads every other package: a token's
context may only be used there to encrypt, and nobody builds one by hand.

**Facebook Pages:** `PageToken` (Messenger) and `PageForPosting` (the
publishing queue). A token that can't be read (a wrong DATA_ENCRYPTION_KEY)
is `ErrNotUsable` and marks nothing: the key is the fix, not a reconnect.

**Getting any connection ready (`Renewer.Prepare`, `renewal.go`):** the ONE
function the publishing queue and the metrics collector call before a
platform: `Prepare(ctx, company, connectionID) (Prepared, error)`.
`Prepared.Kind` is "ready" (with `Token`, `StoredToken` = the access token
as stored, `Target()` for a connector), "needs_reauth" (an owner connects
again; `Code` says why), "unavailable" (no usable token now: try later),
"disconnected" or "not_found". A token running out within 5 minutes is
renewed first where the platform allows (X, Google; LinkedIn only for its
partners), by ONE run at a time: right before asking the platform, the run
claims the renewal in one UPDATE (`renewal_started_at`; a claim over a
minute old is a dead run's and is taken over), since X may refuse a
refresh token once it was used; another run waits for the new tokens (1 s
at a time, 20 looks, then "unavailable" refresh_unavailable), even with
minutes left. The new tokens are saved in ONE UPDATE that names the access
token it replaces: a disconnect, a reconnect or another renewal meanwhile
wins, and the newest token is used. A refused renewal = "needs_reauth"
refresh_refused (the row marked, a "reconnect_needed" activity row, its
tokens kept for a later revoke); no answer = still connected,
refresh_unavailable noted, cleared by the next renewal; past its end with
nothing to renew it = token_expired (a LinkedIn token after its 60 days) or
refresh_expired; this server without the platform's app = "unavailable"
not_set_up, nothing noted; an unreadable token = "unavailable"
token_unreadable, nothing noted. Facebook Page tokens and the stand-in's
never run out. `LongestPreparation` is the most it can take.

**Revoking what a disconnect removed (`RevokeRemoved`, `revoke.go`):** X
and Google only (contentrules.RevokesOnRequest), never for the stand-in,
and only once no connection of that account anywhere still holds tokens
(connected or waiting for a reconnect): their grant is the account's with
ansa's one app, so a revoke would end another company's connection too.
That yes-or-no read is the one cross-company read here (listed in
`CROSS_COMPANY.md`). Best effort: "revoked", "not_offered",
"still_connected" or the failure's code; a failure is one fixed log line
with its code, never a token.

**Tests (live database, a fake platform; refuse to run with any platform
app setting set):** `renewal_test.go` (a token running out renewed and
saved, a fresh one used without asking; a refusal marks the connection and
logs it, a silent platform leaves it usable, no app marks nothing; a
LinkedIn token past its days, Pages and the stand-in; a renewal racing a
disconnect or another renewal never wins; two runs at once ask X once; a
claim within its minute is waited for, an older one taken over, an id in
capitals); `revoke_test.go` (no revoke while another company has the
account, the last one revokes, a failure is one fixed line, LinkedIn and
the stand-in offer none; only this package decrypts tokens; the
cross-company read is listed).
