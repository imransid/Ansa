# teammates (core/internal/teammates)

**What:** the Team page (the old `db/team-members.ts`, `db/invites.ts`,
`db/categories.ts`, `db/user-categories.ts`, `db/teammate-access.ts`,
`db/unconfirmed-accounts.ts` and their services): who is on the team,
invites, roles, removing someone, and the categories routing follows.
Joining through an invite (the user-create hook) stays with signup in
Better Auth until login moves.

**Who may:** only owners invite, revoke, change roles, remove people and
manage categories, never their own role or account; each person ticks the
categories they handle, owners anyone's; everyone reads the team; only
owners see pending invites.

**Every team change takes the company row lock FIRST**
([team](inbox.md) `LockCompanyWithin`), so two owners can't remove or
demote each other at once, routing never runs beside another routing, and
a count (100 active categories) and a creation take turns.

**Invites (`invites.go`):** one address (Zod's own email rule, lower-cased,
at most 254: `addresses.AccountEmail`), a role, 7 days, single use. Saved
only while its creator is an active owner, their row locked FOR SHARE (a
removal or demotion saved at that moment is waited for, then seen). Only
the token's SHA-256 is stored; the link is `<APP_URL>/invite#<token>` (after
"#": browsers never send it to a server). An address of someone on the team
or removed from it is refused. Inviting an address again revokes its
pending invite in the same transaction, before the seats are counted: the
newest link is the one that works, and one person takes one seat (a
refusal for a full team changes nothing). Joining through an invite ends
the address's other pending invites to that company in the joining
transaction (`RevokeInvitesForAddressWithin`, [accounts](accounts.md)): an
older link, or one made at the same moment. Revoking works on a pending
invite only. Limits: 200 created and 200 revoked an hour per company.

**Roles (`roles.go` `SetRole`):** ONE UPDATE holds every rule (an active
owner acting, never on themselves, a confirmed teammate still on the team,
and a demotion only while another active, confirmed owner remains: a
company always keeps one). A demotion revokes the pending invites they made
and disconnects the LinkedIn profiles they connected (those post as them).

**Removing (`Remove`):** the person's row locked "no key update" (assigning
them a request at that moment waits, then sees them removed). A confirmed
teammate is deactivated: the row stays (requests keep the name); their
logins, password and reset links are deleted (Better Auth's tables, matched
through users inside this company), their categories and pending invites
go, their LinkedIn profiles are disconnected, and their open requests are
unassigned (history: the app, about them) and routed again oldest first
([tickets](tickets.md) `UnassignForRemovalWithin`; whoever gets one is
emailed after commit). Someone who never confirmed never logged in: the
account is deleted (`ForgetAccountWithin` takes it off every request and
out of their history), which frees the address.

**Categories (`categories.go`):** names are 1-50 characters, no < or >, no
line break or control character (the AI reads one per line); unique in any
letter case; at most 100 active. Renaming carries requests along (ON UPDATE
CASCADE). Archived, never deleted; restoring routes the open, unassigned
requests waiting in it. `SaveCategoriesOf` replaces the active categories
one person handles: they must be able to take requests (row locked), and
every category is checked inside the INSERT that links it (an unknown,
archived or another company's one undoes everything); links to archived
categories stay; requests waiting in the new categories are routed.

**API ([api](api.md)):** `GET /api/v1/team`; `POST /api/v1/team/invites`
`{email, role}` → `{"link"}`; `POST /api/v1/team/invites/{id}/revoke`;
`POST /api/v1/team/people/{id}/role` `{role}`; `POST
/api/v1/team/people/{id}/remove`; `POST /api/v1/team/people/{id}/categories`
`{categoryIds}`; `POST /api/v1/team/categories` `{name}`; `POST
/api/v1/team/categories/{id}/rename` `{name}`; `POST
/api/v1/team/categories/{id}/archive` `{archived}`. A person's `{id}` is
used exactly as sent (letters, digits, "_" and "-": ids have capitals, so
it is never lower-cased as a category's or an invite's uuid is). Settings
changes count 60 per 10 minutes per person.

**Tests:** `teammates_test.go` (live database: a company always keeps an
owner, a demoted owner's invites are revoked, a member invites and demotes
nobody, an address on the team can't be invited, revoking works once; a
removed teammate's request goes to the next expert of its category, their
logins and categories gone, the expert emailed after commit; an account
that never confirmed is deleted; restoring a renamed category routes its
waiting request; inviting an address again replaces its pending invite,
also with every seat taken, and a full team keeps it); `api/team_test.go`
(also a person whose id has capitals: categories, role, removal).

**Packages (step 57, [packages](packages.md)):** an invite needs a seat in the package (Personal 1, Business and the free trial 3, Pro 10; active people and pending invites counted, read in the invite's transaction): otherwise "team-full", and the Team page says to remove someone, revoke an invite or choose a bigger package.
