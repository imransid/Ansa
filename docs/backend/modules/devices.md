# devices (core/internal/devices)

**What:** the ansa phone app's side of core. An owner shows a QR code on
ansa's website; the app scans it and is connected to that account (no login
typed). While it runs, the app checks in every 30 seconds (in the
background as often as the phone allows). With "Answer for me when my phone
is unreachable for N minutes" on, ansa switches to away by itself when none
of the owners' connected phones has checked in for N minutes, exactly as
"I'm away" does, and back when a phone checks in again, but only an away
the phones set: a person's own "I'm away" is never undone. The exact API is
the contract the screens and the app follow (below).

**Tables (migration `0053_phone_devices`):**
- `device_pair_codes`: one-time codes (company, the owner who made it, the
  code's SHA-256 only, 5 minutes, `used_at`). Deleted by the hourly cleanup
  once expired ([maintenance](maintenance.md)).
- `devices`: a connected phone (company, `paired_by_user_id` with a
  same-company foreign key, name: one plain line of 1-60, platform `ios` /
  `android`, the token's SHA-256 only, `paired_at`, `last_seen_at`,
  `removed_at`). A removed phone keeps its row; its token is refused.
- `phone_presence_changes`: the phones' own lines, `away` (no phone was
  reachable) and `back` (with the phone that checked in), `clock_timestamp()`.
- On `assistant_settings`: `follow_phone` (default off: the page asks),
  `phone_wait_minutes` (1, 5, 15 or 30; default 5), `away_set_by`
  (`person` or `phone`, only while away; an away set before this step has
  none and counts as a person's) and `away_changed_at` (when away was last
  set or cleared, by anyone).

**Pairing (`codes.go`, `pairing.go`):**
- `POST /api/v1/devices/pair-code` (owners, the settings-changes limit; the
  role read again under the company row lock, `settings.AsOwner`): 8
  characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O/1/I/L), drawn
  evenly; the link `ansa://pair?u=<DEVICE_API_URL, URL-encoded>&c=<code>`;
  the QR code of that link as modules (`qr.size`, `qr.rows`: one string of
  0/1 per row, no quiet zone; error correction M), drawn by the screens.
  QR codes are made with `rsc.io/qr` ([dependencies](../dependencies.md)).
- `POST /device/v1/pair` `{"code", "name", "platform"}`: the per-IP limit
  first (20 tries per 10 minutes), the body read strictly, the code read in
  any case with or without its dash. ONE transaction: the code CLAIMED in
  one UPDATE (unused, unexpired: a cross-company read by the hash only ansa
  makes), the company row lock, the code's maker read again (a person
  removed or made a member since: refused, as a wrong code), at most 10
  connected phones per company (the ceiling: 409), the phone saved with its
  token's SHA-256. A refusal rolls back: the code stays unused. Answers the
  token once (32 random bytes, base64url), the phone's id and the status.
  Pairing never changes `follow_phone`.

**The app's calls (`http.go`, `auth.go`):** JSON in and out, bodies up to 4
KB, read strictly (the app is ansa's own: an unknown field is refused; an
empty body counts as `{}`). Every call but pair carries `Authorization:
Bearer <token>`: its SHA-256 finds the phone (a cross-company read by a hash
only ansa issues; no comparison of the token itself, so nothing leaks
through timing), then its owner is read within its company: an unknown
token, a removed phone, or an owner removed or made a member = 401 (the app
forgets its token). Then the phone's ceiling (300 calls per 10 minutes; the
app makes about 40). Errors are `{"error": "<words for a person>"}`. Never
logged: the token, the code, a name.
- `POST /device/v1/heartbeat {}`: the check-in (`checkin.go`), in ONE
  transaction that takes the company row lock first (as the watcher does,
  so the two never cross): `last_seen_at` now and, if the phones had
  switched ansa away, back (`settings.EndAwayWithin`, by no person) with a
  `back` line. Answers `{"status"}`.
- `GET /device/v1/home`: `{"status", "needsYou", "activity"}`: needsYou is
  the web Home's "Needs you" count (`inbox.Counts`, the same condition);
  activity is the web Home's "What ansa did" (`inbox.ListActivity`, the
  newest 6) worded as the web Home words it (`words.go`, the screens'
  ACTIVITY_TEXT, kept equal by `words_test.go`, and the customer named as
  Home names them: their name, "Telegram customer" on a chat, else "a
  customer"), with the phones' own lines among them ("Your phone was
  unreachable: ansa answers for you", "Your phone is back: you're available
  again", `who` ""), newest first, 6 in all.
- `POST /device/v1/away {"away": bool}`: the website Home's "I'm away" /
  "I'm back" (`settings.SetAway`), as the owner who paired the phone: a
  person's own (the phones' check-ins never undo it). The settings-changes
  limit of that owner. Answers `{"status"}`.
- `POST /device/v1/unpair {}`: the phone removed; 204.

**Status (`status.go`, read with Home's own `home.ReadPresence`):**
`accountName` (the company's name: a person's account is named after them),
`kind`, `state` (`paused` before `away` before `available`), `awayBy`
(`you`, `phone`, `hours` or ""), `since` (when away began; "" for the
hours), `answersAlways` (answer_when "always"), `followPhone`,
`waitMinutes`.

**The presence watcher (`watcher.go`; core's scheduler, "phone presence",
every 15 s):** a cross-company look (company ids only) for companies with
`follow_phone` on, not away, at least one phone that counts (not removed,
paired by a confirmed, active owner), whose newest sighting (the latest
check-in, or the pairing for a phone that never checked in) is older than
`phone_wait_minutes`, and was made at or after `away_changed_at`: so a
person's "I'm back" while their phone is off isn't undone 15 seconds later;
the phone must be seen again first. Each company is then switched in its
own transaction: the company row lock, the condition read again
company-scoped (two cores, or a check-in at that moment, find it changed),
then `settings.StartAwayWithin(..., "phone")`: away since now, conversations
a person took over handed back (their `handed_back` lines by no person:
ansa took them back itself, so Home's "What ansa did" lists them), waits
ended, and an `away` line. At most 100 companies a round.

**Turning the setting off** ends an away the phones set (by that owner, as
"I'm back"): the phones no longer decide anything. Removing a phone leaves
an away as it is ("I'm back" ends it).

**For the screens (signed, the session's company; `api/devices.go`):**
- `GET /api/v1/devices` (everyone): `{devices: [{id, name, platform,
  pairedAt, lastSeenAt ("" before the first check-in), reachable (seen
  within the wait, the pairing counting until the first check-in, as the
  watcher counts)}], followPhone, waitMinutes, canChange (owners),
  phoneAway: {since} | null}`.
- `POST /api/v1/devices/pair-code {}` (owners): above.
- `POST /api/v1/devices/{id}/remove {}` (owners): `{"outcome": "removed" |
  "changed"}` ("changed": removed already, or not this company's).
- `POST /api/v1/devices/settings {"followPhone", "waitMinutes"}` (owners;
  1, 5, 15 or 30): `{"outcome": "saved"}`.
- `GET /api/v1/home`'s `presence` also says `awayBy` (`you`, `phone`,
  `hours` or ""), `followPhone` and `phoneWaitMinutes`; `awaySince` is
  when the phones switched it for `phone` ([home](home.md)).

**Settings:** DEVICE_API_URL (how a phone reaches core, inside the QR code;
development default `http://127.0.0.1:8080`, which the iPhone simulator
reaches; the Android emulator uses `http://10.0.2.2:8080`; required in
production, https) and DEVICE_LISTEN_ADDR (development only, unset by
default: core also listens there, serving ONLY `/device/v1/*`
(`OnlyDeviceRoutes`), so a real phone on the same Wi-Fi reaches the laptop
while CORE_LISTEN_ADDR stays on 127.0.0.1; set DEVICE_API_URL to the
laptop's Wi-Fi address and that port; refused in production, where
`/device/v1/*` is on core's own address behind https).

**Tests:** `codes_test.go`: codes of the alphabet, read in any case with or
without the dash; the link; the QR code's square rows with its finder
pattern; a phone's name cleaned and cut. `pairing_test.go` (live database):
a code works once, for its own company only, stored as its hash; an
expired or wrong one connects nothing; a member makes none, and a code
whose maker was removed or made a member since connects nothing and stays
unused; 10 phones at most, the code working again after a removal; a token
stored as its hash only, refused once the phone is removed or its owner
removed or made a member. `watcher_test.go`: away after the wait (as "I'm
away": handed back by no person, a wait ended, one line), not within it,
never twice, never another company; never when off, without a phone, with
a removed phone or one whose owner is a member; a check-in never undoes a
person's "I'm away", and after a person's "I'm back" while the phone is off
the watcher waits for the phone to be seen again; a check-in switches back
what the phones set (with its line naming the phone), switching the
setting off ends it, a removed phone checks in no more. `http_test.go`: the
app's whole life over HTTP (pair with a lower-case dashed code, the
status's fields, the code again refused with the contract's words,
check-in, main screen, away and back as the person's own, unpair then 401);
the main screen's needsYou and words; the refusals (no or a made-up token,
an unknown field, no name, an unknown platform, the phone's ceiling, the
per-IP pairing limit even with a good code); the LAN listener's router
serves only `/device/v1/*`. `words_test.go`: the words equal the screens'
ACTIVITY_TEXT; a customer named as Home names them.
`api/devices_test.go`: the page, a pair code's shape, the listed phone, the
setting's checks, Home's `awayBy`, remove then "changed"; members read
only. `config/devices_test.go`: the defaults and refusals in development
and production. The tenant check reads every statement
(`database/tenant_test.go`).
