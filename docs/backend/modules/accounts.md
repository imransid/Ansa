# accounts (core/internal/accounts)

**What:** everything that opens or closes a login, and a person's own
account (the old `services/signup.ts`, `auth.ts`, `password-reset*.ts`,
`account.ts`, `login-limits.ts`, `email-verification.ts`,
`company-membership.ts`, `lib/known-device.ts`, and Better Auth itself). It
reads and writes Better Auth's own tables (`users`, `accounts`,
`sessions`, `verifications`) in Better Auth's own formats, so logins,
passwords and links made by either backend keep working during the move.
LOGGING RULE: never a password, a token, a link or an address.

**Formats (checked against Better Auth's own code, `vectors_test.go`):**
passwords are scrypt N=16384, r=16, p=1, a 64-byte key, the password in its
NFKC form and the salt used AS its hex text: `<salt hex>:<key hex>`;
confirmation links carry a JWT signed HS256 with BETTER_AUTH_SECRET
(`{email, iat, exp}`, one hour; one carrying `updateTo` or `requestType`
is refused); reset links are 24 letters and digits, stored only as
base64url(SHA-256("reset-password:" + token)) for one hour, the user's id
as the value; ids and session tokens are 32 random letters and digits; the
session cookie is Better Auth's (`__Secure-better-auth.session_token` on
https), the token signed with the secret.

**Signup (`signup.go`):** a name (1-100, no control characters), an
address (the team account rule) and a password (12-128). A new company
named "New business" (nothing in the request names or picks one) with the
person as its owner; joining through an invite instead takes the inviting
company and role, the invite checked BEFORE the address is looked up (a
junk invite answers the same for every address) and claimed once in the
account's own transaction. An address that already has an account changes
nothing and gets the same answer; only its inbox is told ("You already
have an ansa account"). No session until the address is confirmed. Limits:
10 signups an hour per IP; 60 joins an hour per IP and 10 tries per invite
link; invite previews 30 per 15 minutes per IP.

**Confirming (`login.go` `ConfirmEmail`):** the link's token AND the
account's password, together: a link alone never confirms or logs in anyone
(whoever signed up with someone else's address knows the password but never
sees the link). A bad link and a wrong password get one answer and take as
long. 20 per 15 minutes per IP, plus the login limits.

**Login (`LogIn`, `limits.go`):** the limits, in order, each counting only
when the ones before allowed: 100 per 15 minutes per IP; 10 per 15 minutes
per address and IP; then either 10 per 15 minutes for a browser holding a
valid known-device cookie for the address, or 100 an hour per address. A
right password takes its attempt back. Unconfirmed: a fresh confirmation
link (at most 3 an hour) and no session. Removed: no session, told only
"Email or password is incorrect". A login lasts exactly 7 days. The
known-device cookie (`ansa_known_device`, 90 days) is "<id>.<expiry>.<signature
over the address>" with a key of its own made from the secret.

**Reset (`reset.go`):** asking answers every address the same and does the
work after the answer (3 emails an hour per address, counted for every
address; 20 asks an hour per IP); every account gets its link, unconfirmed
ones too, a removed person nothing. Using a link (20 per 15 minutes per IP):
a removed person's does nothing; an unconfirmed account that joined
through an invite is REMOVED instead (`teammates.RemoveUnconfirmed`: the
address may be a typo or an owner's squat), freeing the address; otherwise
ONE transaction sets the password, uses the link up, ends every login and
voids the other links.

**Account (`account.go`):** your name (30 changes per 10 minutes); your
password once the current one checks out (10 tries per 15 minutes): every
login ends, this browser gets a fresh one, reset links are voided; "log out
on all other devices"; logout ends this login only.

**Emails (`emails.go`):** "Confirm your email address", "You already have
an ansa account", "Reset your ansa password", from "ansa" <EMAIL_FROM>,
never repeating the name typed at signup; links put their token after "#"
(never in a server's logs). A new idempotency key each.

**API ([api](api.md)):** public (signed by the screens, nobody logged in;
the screens send the browser's IP, browser and known-device cookie in the
body, and set the cookies core answers): `POST /api/v1/auth/signup`,
`/join`, `/invite-preview`, `/login`, `/confirm`, `/reset-request`, `/reset`.
Logout needs no live login (`POST /api/v1/auth/logout`: an ended login
still gets the cookie that clears it). Logged in: `GET /api/v1/me` (who is
logged in, for every page of the screens: id, name, address, role; never the
company's id), `GET /api/v1/account`, `POST
/api/v1/account/name`, `/password`, `/logout-others`.

**Tests:** `vectors_test.go` (Better Auth's own hash and link work here,
ours work for an hour); `accounts_test.go` (live database, a fake mailer:
signup, no login before confirming, an existing address answered the same
and told by email, a link alone confirms nobody, a new company owned, ten
wrong passwords from one place stop that place while a known browser
elsewhere still gets in; a reset works once and ends every login; an
invite works only for its address, decides the company, and its typo is
removed by its reset link; a password change keeps only this browser's
fresh login); `api/auth_test.go` (signup, the emailed link, confirm,
account, logout through the API).
