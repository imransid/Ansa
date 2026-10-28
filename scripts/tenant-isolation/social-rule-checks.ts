// Social account checks (step 40), part 3: no token, code, state or
// verifier reaches the page's data, an address or the logs, whatever
// happens; Postgres refuses a connection that breaks the rules, and its
// CHECKs list exactly the code's values; removing a teammate, or making an
// owner a member (step 41 review), disconnects the LinkedIn profiles they
// connected. Fake platforms only.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { socialConnections } from "@/db/schema";
import { describeActivity } from "@/lib/publishing/activity-text";
import { socialAccountKinds, socialConnectionStatuses, socialPlatforms, STAND_IN_ACCOUNT_ID } from "@/lib/social-platforms";
import { getQueuePageForSession } from "@/services/publishing-pages";
import { getSocialAccountsPageForSession } from "@/services/social-accounts";
import { disconnectSocialAccountForSession } from "@/services/social-disconnect";
import { prepareConnectionForUse } from "@/services/social-tokens";
import { changeTeammateRoleForSession, removeTeammateForSession } from "@/services/team";
import { addTeammate, assertRefusedByConstraint, captureConsole, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { collectingAfter } from "./media-helpers";
import { activityRows, approvedDraftOf, jobRow, makeDue, runNow, scheduledJobIds, throughFakePlatform } from "./publishing-helpers";
import {
  comeBack,
  connectFully,
  connectionRows,
  everyPlatformReal,
  facebookConnects,
  fakePlatform,
  fakeCredentials,
  json,
  linkedInConnects,
  noPlatform,
  ownXAccountId,
  startConnecting,
  xConnects,
} from "./social-helpers";

// The values one CHECK of social_connections allows, as Postgres writes it back.
async function checkListOf(constraintName: string): Promise<string[]> {
  const result = await db.execute<{ definition: string }>(
    sql`select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'social_connections'::regclass and conname = ${constraintName}`,
  );
  return [...(result.rows[0]?.definition ?? "").matchAll(/'([^']*)'::text/g)].map((match) => match[1]);
}

export async function runSocialRuleChecks() {
  await check("social accounts: no token, code, state, PKCE verifier or app secret reaches the page's data, an address or the logs, when connecting works and when it fails", async () => {
    const owner = sessionFor(await signUpTestOwner("social-secrets"));
    const secrets = [`x-access-${runId}`, `x-refresh-${runId}`, `code-${runId}`, fakeCredentials("x").clientSecret];
    const { result: landings, logs } = await captureConsole(async () => {
      const worked = await connectFully(owner, "x", xConnects(ownXAccountId()));
      // The token endpoint refuses, quoting the code back (as platforms do).
      const refused = await connectFully(owner, "x", [json({ error: "invalid_request", error_description: `bad code code-${runId}` }, 400)]);
      const { state } = await startConnecting(owner, "x");
      const denied = await comeBack(owner, "x", { state, error: "access_denied", error_description: `x-access-${runId}` }, { modeOf: everyPlatformReal, fetchFn: fakePlatform([]).fetchFn });
      const [row] = await connectionRows(owner.companyId);
      const after = collectingAfter();
      await prepareConnectionForUse(owner.companyId, row.id, { modeOf: everyPlatformReal, fetchFn: fakePlatform([]).fetchFn });
      await disconnectSocialAccountForSession(owner, { connectionId: row.id }, after.run, { modeOf: everyPlatformReal, fetchFn: fakePlatform([new Response("no", { status: 503 })]).fetchFn });
      await after.settle();
      return [worked.landing, refused.landing, denied];
    });
    assert.deepEqual(landings, [
      "/cofounder/accounts?result=connected&platform=x",
      "/cofounder/accounts?result=exchange_failed&platform=x",
      "/cofounder/accounts?result=denied&platform=x",
    ]);
    const page = JSON.stringify(await getSocialAccountsPageForSession(owner, { modeOf: everyPlatformReal }));
    const states = await db.execute<{ state_hash: string }>(sql`select state_hash from oauth_states where company_id = ${owner.companyId}`);
    for (const secret of secrets) {
      assert.ok(!logs.join("\n").includes(secret), `the logs hold ${secret}`);
      assert.ok(!page.includes(secret), `the page's data holds ${secret}`);
    }
    assert.ok(!page.includes("v1:"), "the page's data holds a ciphertext");
    assert.ok(states.rows.length >= 3);
    assert.deepEqual(logs.filter((line) => line.startsWith("Social")), ["Social connection not made: x exchange_failed", "Social connection not made: x denied", "Social revoke failed: x status_503"]);
  });

  await check("social accounts: Postgres refuses a connected row without a token, tokens on a disconnected one, unknown values, a kind that doesn't fit the platform, a second row for one account, a message as last_error, a real account under the stand-in's id, a renewal claim on a connection that isn't connected and a person of another company", async () => {
    const ownerUser = await signUpTestOwner("social-db");
    const stranger = await signUpTestOwner("social-db-other");
    const row = (changes: Partial<typeof socialConnections.$inferInsert>) =>
      db.insert(socialConnections).values({
        companyId: ownerUser.companyId,
        platform: "linkedin",
        externalAccountId: `m-${randomUUID()}`,
        displayName: "Ana",
        accountKind: "member",
        accessTokenEncrypted: "v1:a:b:c",
        connectedByUserId: ownerUser.id,
        ...changes,
      });
    await assertRefusedByConstraint(row({ accessTokenEncrypted: null }), "social_connections_connected_has_token");
    await assertRefusedByConstraint(row({ status: "disconnected", disconnectedAt: new Date() }), "social_connections_disconnected_fields");
    await assertRefusedByConstraint(row({ status: "disconnected", accessTokenEncrypted: null }), "social_connections_disconnected_fields");
    await assertRefusedByConstraint(row({ status: "needs_reauth" }), "social_connections_needs_reauth_has_reason");
    // Postgres names the first failing CHECK by name: an unknown platform fits no kind either.
    await assertRefusedByConstraint(row({ platform: "instagram" as "x" }), "social_connections_kind_fits_platform");
    await assertRefusedByConstraint(row({ accountKind: "group" as "page" }), "social_connections_account_kind_known");
    await assertRefusedByConstraint(row({ status: "paused" as "connected" }), "social_connections_status_known");
    await assertRefusedByConstraint(row({ platform: "youtube", accountKind: "page" }), "social_connections_kind_fits_platform");
    await assertRefusedByConstraint(row({ lastError: "LinkedIn said: Unauthorized for token abc" }), "social_connections_last_error_is_code");
    await assertRefusedByConstraint(row({ externalAccountId: STAND_IN_ACCOUNT_ID }), "social_connections_stand_in_id");
    await assertRefusedByConstraint(row({ isStandIn: true }), "social_connections_stand_in_id");
    await assertRefusedByConstraint(row({ externalAccountId: "has space" }), "social_connections_external_account_id_format");
    await assertRefusedByConstraint(row({ displayName: "" }), "social_connections_display_name_length");
    await assertRefusedByConstraint(row({ refreshExpiresAt: new Date() }), "social_connections_refresh_expiry_with_token");
    // Every change of status ends a renewal claim (db/social-connection-tokens.ts).
    await assertRefusedByConstraint(row({ status: "needs_reauth", lastError: "refresh_refused", renewalStartedAt: new Date() }), "social_connections_renewal_only_connected");
    await assertRefusedByConstraint(row({ connectedByUserId: stranger.id }), "social_connections_connector_in_same_company_fk");
    await row({ externalAccountId: `twice-${runId}` });
    await assertRefusedByConstraint(row({ externalAccountId: `twice-${runId}` }), "social_connections_company_platform_account_unique");
  });

  await check("social accounts: the database's CHECKs list exactly the code's platforms, account kinds and statuses", async () => {
    assert.deepEqual((await checkListOf("social_connections_platform_known")).sort(), [...socialPlatforms].sort());
    assert.deepEqual((await checkListOf("social_connections_account_kind_known")).sort(), [...socialAccountKinds].sort());
    assert.deepEqual((await checkListOf("social_connections_status_known")).sort(), [...socialConnectionStatuses].sort());
  });

  await check("team: removing a teammate disconnects the LinkedIn profiles they connected (those post as them), in the removal itself; the company's Pages stay connected", async () => {
    const ownerUser = await signUpTestOwner("social-leaver");
    const leaver = await addTeammate(ownerUser, "social-leaver-gone", "owner");
    await connectFully(sessionFor(leaver), "linkedin", linkedInConnects(`leaver${runId}`, "Leaving Lee"));
    await connectFully(sessionFor(leaver), "facebook", facebookConnects([{ id: "444", name: "Ansa Bakery", tasks: ["CREATE_CONTENT"] }]));
    assert.deepEqual(await removeTeammateForSession(sessionFor(ownerUser), { userId: leaver.id }), { ok: true });
    const rows = await connectionRows(ownerUser.companyId);
    const profile = rows.find((row) => row.platform === "linkedin");
    const page = rows.find((row) => row.platform === "facebook");
    assert.deepEqual([profile?.status, profile?.accessTokenEncrypted, page?.status], ["disconnected", null, "connected"]);
  });

  await check("team: making an owner a member disconnects the LinkedIn profiles they connected (those post as them, and a member can neither cancel a post nor disconnect one), in the change itself, the app's doing in the log; the company's Pages stay connected, and a post waiting for that profile fails when it runs (account_disconnected), nothing sent", async () => {
    const ownerUser = await signUpTestOwner("social-made-member");
    const owner = sessionFor(ownerUser);
    const demoted = await addTeammate(ownerUser, "social-made-member-owner", "owner");
    await connectFully(sessionFor(demoted), "linkedin", linkedInConnects(`demoted${runId}`, "Demoted Dee"));
    await connectFully(sessionFor(demoted), "facebook", facebookConnects([{ id: "445", name: "Ansa Bakery", tasks: ["CREATE_CONTENT"] }]));
    const profileId = (await connectionRows(ownerUser.companyId)).find((row) => row.platform === "linkedin")?.id;
    assert.ok(profileId, "no LinkedIn profile");
    const [jobId] = await scheduledJobIds(owner, await approvedDraftOf(owner), [profileId]);
    assert.deepEqual(await changeTeammateRoleForSession(owner, { userId: demoted.id, role: "member" }), { ok: true });
    const rows = await connectionRows(ownerUser.companyId);
    const profile = rows.find((row) => row.platform === "linkedin");
    const page = rows.find((row) => row.platform === "facebook");
    assert.deepEqual([profile?.status, profile?.accessTokenEncrypted, page?.status], ["disconnected", null, "connected"]);
    const disconnects = (await activityRows(ownerUser.companyId)).filter((entry) => entry.action === "disconnected");
    assert.deepEqual(disconnects.map((entry) => [entry.connectionId, entry.actorUserId, entry.code]), [[profileId, null, "teammate_made_member"]]);
    const sentences = (await getQueuePageForSession(owner)).activity.map((entry) => describeActivity(entry));
    assert.ok(sentences.includes("LinkedIn (Demoted Dee) was disconnected: the owner who connected it was made a member."), sentences.join("\n"));
    await makeDue(jobId);
    assert.equal(await runNow(owner, jobId, throughFakePlatform(noPlatform)), "failed");
    assert.equal((await jobRow(jobId)).lastError, "account_disconnected");
  });
}
