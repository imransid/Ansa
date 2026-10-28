// Social account checks (step 40), part 1: connection attempts. Connect
// stores only the state's SHA-256 hash (and the PKCE verifier encrypted)
// for 10 minutes; the platform's redirect back works once, for the person,
// company and platform that started it; refusals, missing parts and no
// login end on a plain message; the daily job deletes expired attempts.
// Fake platforms only (social-helpers.ts).

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { oauthStates, users } from "@/db/schema";
import { decryptText } from "@/lib/encryption";
import { oauthPkceVerifierContext } from "@/lib/encryption-contexts";
import { socialPlatforms } from "@/lib/social-platforms";
import { handleSocialCallback } from "@/services/social-oauth-callback";
import { runCleanup } from "@/services/maintenance";
import { addTeammate, assertRefusedByConstraint, captureConsole, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { comeBack, connectionRows, everyPlatformReal, fakePlatform, linkedInConnects, startConnecting, stateRows, xConnects } from "./social-helpers";

const sha256Hex = (text: string) => createHash("sha256").update(text).digest("hex");
const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

// The state's row, by the state the authorize URL carried.
async function stateRow(state: string) {
  const [row] = await db.select().from(oauthStates).where(eq(oauthStates.stateHash, sha256Hex(state)));
  assert.ok(row, "no attempt was saved under the state's hash");
  return row;
}

export async function runSocialStateChecks() {
  await check("social accounts: Connect saves only the state's SHA-256 hash, for 10 minutes, tied to the person, company and platform; X and YouTube get a PKCE verifier stored encrypted and its S256 challenge in the authorize URL, LinkedIn and Facebook none", async () => {
    const owner = sessionFor(await signUpTestOwner("social-state"));
    const other = sessionFor(await signUpTestOwner("social-state-other"));
    for (const platform of socialPlatforms) {
      const { url, state, challenge } = await startConnecting(owner, platform);
      assert.match(state, /^[A-Za-z0-9_-]{43}$/, `${platform}: the state is not 32 random bytes`);
      const row = await stateRow(state);
      assert.deepEqual([row.companyId, row.userId, row.platform, row.usedAt], [owner.companyId, owner.userId, platform, null]);
      assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), 10 * 60 * 1000);
      assert.ok(!JSON.stringify(row).includes(state), `${platform}: the state itself is stored`);
      if (platform === "x" || platform === "youtube") {
        assert.ok(row.pkceVerifierEncrypted, `${platform}: no PKCE verifier`);
        const verifier = decryptText(row.pkceVerifierEncrypted, oauthPkceVerifierContext(owner.companyId, row.id));
        assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/);
        assert.ok(!row.pkceVerifierEncrypted.includes(verifier), "the verifier is stored readable");
        assert.equal(challenge, s256(verifier));
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        assert.throws(() => decryptText(row.pkceVerifierEncrypted ?? "", oauthPkceVerifierContext(other.companyId, row.id)));
      } else {
        assert.deepEqual([row.pkceVerifierEncrypted, challenge], [null, null], `${platform} has no PKCE`);
      }
    }
    assert.equal((await stateRows(owner.companyId)).length, 4);
  });

  await check("social accounts: two returns with one state at the same moment: one connects (LinkedIn is asked once), the other is told the link was used, and the state never works again", async () => {
    const owner = sessionFor(await signUpTestOwner("social-twice"));
    const { state } = await startConnecting(owner, "linkedin");
    const platform = fakePlatform([...linkedInConnects(), ...linkedInConnects()]);
    const options = { modeOf: everyPlatformReal, fetchFn: platform.fetchFn };
    const landings = await Promise.all([
      comeBack(owner, "linkedin", { state, code: `first-${runId}` }, options),
      comeBack(owner, "linkedin", { state, code: `second-${runId}` }, options),
    ]);
    assert.deepEqual(landings.sort(), ["/cofounder/accounts?result=connected&platform=linkedin", "/cofounder/accounts?result=expired_state&platform=linkedin"]);
    assert.equal(platform.requests.filter((request) => request.url === "https://www.linkedin.com/oauth/v2/accessToken").length, 1);
    assert.equal((await connectionRows(owner.companyId)).length, 1);
    assert.equal(await comeBack(owner, "linkedin", { state, code: `third-${runId}` }, options), "/cofounder/accounts?result=expired_state&platform=linkedin");
    assert.equal(platform.requests.length, 2, "a used state reached the platform");
    assert.ok((await stateRow(state)).usedAt);
  });

  await check("social accounts: a state works only for the person, company and platform that started it, and not after its 10 minutes; X gets the verifier whose challenge it was shown", async () => {
    const ownerUser = await signUpTestOwner("social-bound");
    const owner = sessionFor(ownerUser);
    const otherOwner = sessionFor(await addTeammate(ownerUser, "social-bound-co", "owner"));
    const stranger = sessionFor(await signUpTestOwner("social-bound-stranger"));
    const { state, challenge } = await startConnecting(owner, "x");
    const platform = fakePlatform(xConnects());
    const options = { modeOf: everyPlatformReal, fetchFn: platform.fetchFn };
    const code = `code-${runId}`;
    assert.match(await comeBack(otherOwner, "x", { state, code }, options), /result=expired_state&platform=x$/);
    assert.match(await comeBack(stranger, "x", { state, code }, options), /result=expired_state&platform=x$/);
    assert.match(await comeBack(owner, "youtube", { state, code }, options), /result=expired_state&platform=youtube$/);
    assert.equal(platform.requests.length, 0);
    // Untouched by the wrong ones: its own owner still connects with it.
    assert.equal(await comeBack(owner, "x", { state, code }, options), "/cofounder/accounts?result=connected&platform=x");
    const verifier = new URLSearchParams(String(platform.requests[0].body)).get("code_verifier") ?? "";
    assert.equal(s256(verifier), challenge);
    // Past its 10 minutes.
    const late = await startConnecting(owner, "linkedin");
    const longAgo = new Date(Date.now() - 11 * 60 * 1000);
    await db.update(oauthStates).set({ createdAt: longAgo, expiresAt: new Date(longAgo.getTime() + 10 * 60 * 1000) }).where(eq(oauthStates.stateHash, sha256Hex(late.state)));
    const lateFake = fakePlatform(linkedInConnects());
    assert.match(await comeBack(owner, "linkedin", { state: late.state, code }, { modeOf: everyPlatformReal, fetchFn: lateFake.fetchFn }), /result=expired_state/);
    assert.equal(lateFake.requests.length, 0);
  });

  await check("social accounts: a refusal, another platform error, a missing code, a missing or made-up state and no login each end on a plain message; the address and the logs hold nothing the platform sent", async () => {
    const owner = sessionFor(await signUpTestOwner("social-refusals"));
    const options = { modeOf: everyPlatformReal, fetchFn: fakePlatform([]).fetchFn };
    const said = `<script>${runId}</script>`;
    const cases: [Record<string, string>, string][] = [
      [{ error: "access_denied", error_description: said }, "denied"],
      [{ error: "user_cancelled_authorize", error_description: said }, "denied"],
      [{ error: "server_error", error_description: said }, "provider_error"],
      [{ error: said }, "provider_error"],
      [{}, "missing_code"],
    ];
    for (const [query, expected] of cases) {
      const { state } = await startConnecting(owner, "facebook");
      const { result: landing, logs } = await captureConsole(() => comeBack(owner, "facebook", { state, ...query }, options));
      assert.equal(landing, `/cofounder/accounts?result=${expected}&platform=facebook`);
      assert.deepEqual(logs, [`Social connection not made: facebook ${expected}`]);
      // The attempt is used up whatever came back.
      assert.match(await comeBack(owner, "facebook", { state, code: `later-${runId}` }, options), /result=expired_state/);
    }
    const withoutRealStates: Record<string, string>[] = [{ code: `code-${runId}` }, { state: `made-up-${runId}`, code: `code-${runId}` }, { state: "x".repeat(501), code: "c" }];
    for (const query of withoutRealStates) {
      assert.match(await comeBack(owner, "facebook", query, options), /result=expired_state&platform=facebook$/);
    }
    // No login: off to the login page, which brings them back to Accounts; the attempt stays for its owner.
    const { state } = await startConnecting(owner, "linkedin");
    assert.equal(await comeBack(null, "linkedin", { state, code: `code-${runId}` }, options), "/login?next=%2Fcofounder%2Faccounts");
    assert.equal((await stateRow(state)).usedAt, null);
    // A platform we don't know: not found.
    assert.equal((await handleSocialCallback(owner, "myspace", new URLSearchParams({ state, code: "c" }), options)).status, 404);
    assert.equal((await connectionRows(owner.companyId)).length, 0);
  });

  await check("social accounts: an owner made a member before coming back connects nothing (the session's role, then the role read again in /db)", async () => {
    const ownerUser = await signUpTestOwner("social-demoted");
    const owner = sessionFor(ownerUser);
    const { state } = await startConnecting(owner, "linkedin");
    const platform = fakePlatform(linkedInConnects());
    const options = { modeOf: everyPlatformReal, fetchFn: platform.fetchFn };
    assert.match(await comeBack({ ...owner, role: "member" }, "linkedin", { state, code: "c" }, options), /result=not_owner/);
    assert.equal(platform.requests.length, 0);
    // The session still says owner, the database says member: refused when saving.
    const second = await startConnecting(owner, "linkedin");
    await db.update(users).set({ role: "member" }).where(eq(users.id, ownerUser.id));
    assert.match(await comeBack(owner, "linkedin", { state: second.state, code: "c" }, options), /result=not_owner/);
    assert.equal(platform.requests.length, 2, "LinkedIn was not asked before the save");
    assert.equal((await connectionRows(owner.companyId)).length, 0);
  });

  await check("social accounts: the daily job deletes expired connection attempts, used or not, and keeps fresh ones", async () => {
    const owner = sessionFor(await signUpTestOwner("social-cleanup"));
    const expired = [await startConnecting(owner, "linkedin"), await startConnecting(owner, "x")];
    const fresh = await startConnecting(owner, "youtube");
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    for (const { state } of expired) {
      await db.update(oauthStates).set({ createdAt: longAgo, expiresAt: new Date(longAgo.getTime() + 60_000) }).where(eq(oauthStates.stateHash, sha256Hex(state)));
    }
    await db.update(oauthStates).set({ usedAt: new Date(longAgo.getTime() + 1000) }).where(eq(oauthStates.stateHash, sha256Hex(expired[0].state)));
    const counts = await runCleanup();
    assert.ok(counts.oauthStates >= 2, JSON.stringify(counts));
    assert.deepEqual((await stateRows(owner.companyId)).map((row) => row.stateHash), [sha256Hex(fresh.state)]);
  });

  await check("social accounts: Postgres refuses an attempt with PKCE where the platform has none (or none where it has), longer than 10 minutes, a state that isn't a SHA-256 hash, a reused hash and a person of another company", async () => {
    const ownerUser = await signUpTestOwner("social-state-db");
    const stranger = await signUpTestOwner("social-state-db-other");
    const attempt = (changes: Partial<typeof oauthStates.$inferInsert>) =>
      db.insert(oauthStates).values({
        id: randomUUID(),
        companyId: ownerUser.companyId,
        userId: ownerUser.id,
        platform: "linkedin",
        stateHash: sha256Hex(randomUUID()),
        pkceVerifierEncrypted: null,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        ...changes,
      });
    await assertRefusedByConstraint(attempt({ platform: "x" }), "oauth_states_pkce_where_supported");
    await assertRefusedByConstraint(attempt({ pkceVerifierEncrypted: "v1:a:b:c" }), "oauth_states_pkce_where_supported");
    await assertRefusedByConstraint(attempt({ expiresAt: new Date(Date.now() + 11 * 60 * 1000) }), "oauth_states_lifetime");
    await assertRefusedByConstraint(attempt({ stateHash: `plain-state-${runId}` }), "oauth_states_state_hash_format");
    await assertRefusedByConstraint(attempt({ userId: stranger.id }), "oauth_states_user_in_same_company_fk");
    const hash = sha256Hex(randomUUID());
    await attempt({ stateHash: hash });
    await assertRefusedByConstraint(attempt({ stateHash: hash }), "oauth_states_state_hash_unique");
  });
}
