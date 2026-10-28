// Invite limit checks (step 23): one invite link can be tried only so often,
// wherever the tries come from, without touching other links; and creating
// and revoking invites each have their own, larger counter, so onboarding a
// big team isn't stopped at 30 an hour.

import assert from "node:assert/strict";
import { getPendingInvitesForCompany } from "@/db/invites";
import type { FormResult } from "@/lib/form-result";
import { createInviteForSession, revokeInviteForSession } from "@/services/invites";
import { isOverRateLimit, RATE_LIMITS } from "@/services/rate-limit";
import { joinCompanyWithInvite } from "@/services/signup";
import { requestHeadersFrom, userIdsWithEmail } from "./account-helpers";
import { check, inviteAs, sessionFor, signUpTestOwner, testEmail, testPassword } from "./helpers";

function messageOf(result: FormResult): string {
  return result.ok ? "(it worked)" : (result.errors.message ?? "(no message)");
}

export async function runInviteLimitChecks() {
  await check("invite limits: one invite link takes 10 tries an hour from any number of IPs; other links are unaffected", async () => {
    const owner = await signUpTestOwner("invite-link-limit");
    const invited = testEmail("invite-link-limit-invitee");
    const inviteToken = await inviteAs(owner, invited, "member");
    const wrongEmail = testEmail("invite-link-limit-guesser");
    for (let attempt = 0; attempt < RATE_LIMITS.inviteJoinsPerInvite.maxAttempts; attempt++) {
      const joinInput = { inviteToken, name: "Guesser", email: wrongEmail, password: testPassword };
      const tried = await joinCompanyWithInvite(joinInput, requestHeadersFrom(`invite-link-limit-${attempt}`));
      assert.match(messageOf(tried), /This invite link has expired/);
    }
    const realJoin = { inviteToken, name: "Invitee", email: invited, password: testPassword };
    assert.match(messageOf(await joinCompanyWithInvite(realJoin, requestHeadersFrom("invite-link-limit-real"))), /Too many tries with this invite link/);
    assert.deepEqual(await userIdsWithEmail(invited), []);
    const otherEmail = testEmail("invite-link-limit-other");
    const otherJoin = { inviteToken: await inviteAs(owner, otherEmail, "member"), name: "Other", email: otherEmail, password: testPassword };
    assert.deepEqual(await joinCompanyWithInvite(otherJoin, requestHeadersFrom("invite-link-limit-0")), { ok: true });
  });

  await check("invite limits: more than 30 new invites an hour, and revoking has its own counter", async () => {
    const owner = await signUpTestOwner("invite-burst");
    const asOwner = sessionFor(owner);
    const burst = 35;
    for (let invite = 0; invite < burst; invite++) {
      const created = await createInviteForSession(asOwner, { email: testEmail(`invite-burst-${invite}`), role: "member" });
      assert.equal(created.ok, true, `invite ${invite + 1}`);
    }
    // Use up the rest of this hour's new invites: creating stops, revoking still works.
    for (let used = burst; used < RATE_LIMITS.inviteCreationsPerCompany.maxAttempts; used++) {
      await isOverRateLimit("invite-creations", owner.companyId, RATE_LIMITS.inviteCreationsPerCompany);
    }
    const refused = await createInviteForSession(asOwner, { email: testEmail("invite-burst-over"), role: "member" });
    assert.match(messageOf(refused), /Too many new invites/);
    const [oldest] = await getPendingInvitesForCompany(owner.companyId);
    assert.deepEqual(await revokeInviteForSession(asOwner, { inviteId: oldest.id }), { ok: true });
  });
}
