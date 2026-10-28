// Operator script checks: pnpm link:phone-line (and unlink, show and replace
// forwarding address, through scripts/company-of-user.ts) finds a company only
// by the address of an owner who confirmed it and was not removed: never by a
// member, an unconfirmed account an invite made (another company's owner may
// have invited that address), or a removed owner. The scripts print the
// company's name first and change nothing without --yes. The scripts run as
// the operator runs them (tsx, local database only).

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { getInboundTokenForCompany } from "@/db/inbound-emails";
import { findPhoneLineByVapiNumberId } from "@/db/phone-lines";
import { joinCompanyWithInvite } from "@/services/signup";
import { findOwnersCompany } from "../company-of-user";
import { requestHeadersFrom, userIdsWithEmail } from "./account-helpers";
import { addTeammate, check, inviteAs, runId, signUpTestOwner, testEmail, testPassword, unconfirmedAccountIds, type TestUser } from "./helpers";
import { markRemovedInDatabaseOnly } from "./team-helpers";

const ROOT = process.cwd();
const run = promisify(execFile);

// Runs one operator script with these arguments. Returns its exit code and output.
async function runScript(script: string, args: string[], extraEnv: Record<string, string> = {}) {
  const tsx = path.join(ROOT, "node_modules", ".bin", "tsx");
  const options = { cwd: ROOT, env: { ...process.env, ...extraEnv }, timeout: 60_000 };
  try {
    const { stdout, stderr } = await run(tsx, ["--conditions=react-server", path.join("scripts", script), ...args], options);
    return { exitCode: 0, output: stdout + stderr };
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    return { exitCode: Number(failed.code), output: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

// Joins `owner`'s company as an OWNER through a real invite, never confirming
// the address: what an owner inviting someone else's address leaves behind.
async function joinAsUnconfirmedOwner(owner: TestUser, label: string): Promise<string> {
  const email = testEmail(label);
  const inviteToken = await inviteAs(owner, email, "owner");
  const joined = await joinCompanyWithInvite({ inviteToken, name: "Never confirmed", email, password: testPassword }, requestHeadersFrom(label));
  assert.deepEqual(joined, { ok: true });
  unconfirmedAccountIds.push(...(await userIdsWithEmail(email)));
  return email;
}

export async function runOperatorScriptChecks() {
  const owner = await signUpTestOwner("operator");
  const squatter = await signUpTestOwner("operator-squatter");

  await check("operator scripts: only a confirmed, active owner's address finds a company (not a member, an unconfirmed invitee or a removed owner)", async () => {
    const found = await findOwnersCompany(` ${owner.email.toUpperCase()} `);
    assert.deepEqual(found, { companyId: owner.companyId, companyName: `Isolation test operator ${runId}` });
    const member = await addTeammate(owner, "operator-member", "member");
    assert.equal(await findOwnersCompany(member.email), undefined);
    assert.equal(await findOwnersCompany(await joinAsUnconfirmedOwner(squatter, "operator-invitee")), undefined);
    const removedOwner = await addTeammate(owner, "operator-removed-owner", "owner");
    assert.equal((await findOwnersCompany(removedOwner.email))?.companyId, owner.companyId);
    await markRemovedInDatabaseOnly(removedOwner.id);
    assert.equal(await findOwnersCompany(removedOwner.email), undefined);
  });

  await check("operator scripts: link:phone-line prints the company's name and links only with --yes; an invitee's address links nothing", async () => {
    const lineId = `pn-operator-${runId}`;
    const invitee = await joinAsUnconfirmedOwner(squatter, "operator-link-invitee");
    const refused = await runScript("link-phone-line.ts", [invitee, lineId, "--yes"]);
    assert.equal(refused.exitCode, 1, refused.output);
    assert.match(refused.output, /is not the confirmed address of an owner/);
    assert.equal(await findPhoneLineByVapiNumberId(lineId), undefined);

    const preview = await runScript("link-phone-line.ts", [owner.email, lineId]);
    assert.equal(preview.exitCode, 1, preview.output);
    assert.ok(preview.output.includes(`Company: "Isolation test operator ${runId}"`), preview.output);
    assert.match(preview.output, /Nothing was changed\. .* --yes/);
    assert.equal(await findPhoneLineByVapiNumberId(lineId), undefined, "linked without --yes");

    const linked = await runScript("link-phone-line.ts", [owner.email, lineId, "--yes"]);
    assert.equal(linked.exitCode, 0, linked.output);
    assert.equal((await findPhoneLineByVapiNumberId(lineId))?.companyId, owner.companyId);
  });

  await check("operator scripts: replace:forwarding-address changes nothing without --yes", async () => {
    const token = await getInboundTokenForCompany(owner.companyId);
    const preview = await runScript("replace-forwarding-address.ts", [owner.email], { INBOUND_EMAIL_DOMAIN: "inbound.example.test" });
    assert.equal(preview.exitCode, 1, preview.output);
    assert.ok(preview.output.includes(`Company: "Isolation test operator ${runId}"`), preview.output);
    assert.equal(await getInboundTokenForCompany(owner.companyId), token, "replaced without --yes");
  });
}
