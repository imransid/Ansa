// Better Auth's own HTTP routes (steps 12, 21 and 22): nothing mounts its
// handler, only our services call its confirm, reset and account endpoints,
// and even a mounted handler would refuse to confirm from a link alone, to
// send links or to set a password from a reset link.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { auth } from "@/lib/auth";
import { accountEmailFiles, accountState, newestVerificationToken } from "./account-helpers";
import { check, runId, testEmail, testPassword } from "./helpers";
import { appSourceFiles } from "./source-helpers";

// The app's source files whose code contains `text`.
async function sourceFilesContaining(text: string): Promise<string[]> {
  const matches: string[] = [];
  for (const filePath of await appSourceFiles()) {
    if ((await readFile(filePath, "utf8")).includes(text)) {
      matches.push(filePath);
    }
  }
  return matches.sort();
}

// The status a mounted handler would answer, e.g. for GET /api/auth/verify-email?token=...
async function handlerStatus(route: string, init?: RequestInit): Promise<number> {
  const { baseURL } = await auth.$context;
  const response = await auth.handler(new Request(`${baseURL}${route}`, init));
  return response.status;
}

export async function runAuthHandlerChecks() {
  await check("auth routes: nothing but the link-plus-password service calls Better Auth's verifyEmail", async () => {
    assert.deepEqual(await sourceFilesContaining("api.verifyEmail("), ["services/auth.ts"]);
  });

  await check("auth routes: only the reset and account services call Better Auth's reset and account endpoints", async () => {
    // The reset email waits for after() only when asked for through
    // services/password-reset.ts (services/password-reset-email.ts).
    assert.deepEqual(await sourceFilesContaining("api.requestPasswordReset("), ["services/password-reset.ts"]);
    assert.deepEqual(await sourceFilesContaining("api.resetPassword("), ["services/password-reset.ts"]);
    assert.deepEqual(await sourceFilesContaining("api.changePassword("), ["services/account.ts"]);
    assert.deepEqual(await sourceFilesContaining("api.revokeOtherSessions("), ["services/account.ts"]);
  });

  await check("auth routes: nothing mounts Better Auth's HTTP handler", async () => {
    for (const text of ["auth.handler", "toNextJsHandler", "toNodeHandler"]) {
      assert.deepEqual(await sourceFilesContaining(text), [], `found "${text}"`);
    }
  });

  await check("auth routes: even a mounted handler can't confirm from the link alone, send links or set passwords", async () => {
    const email = testEmail("verify-handler");
    const body = { name: "Handler", email, password: testPassword, companyName: `Isolation test handler ${runId}` };
    const userId = (await auth.api.signUpEmail({ body })).user.id;
    const token = await newestVerificationToken(userId);
    // A route that is on answers, so the 404s below come from disabledPaths.
    assert.equal(await handlerStatus("/ok"), 200, "the handler answers nothing at this address");
    assert.equal(await handlerStatus(`/verify-email?token=${token}`), 404);
    const askForLink = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) };
    assert.equal(await handlerStatus("/send-verification-email", askForLink), 404);
    assert.equal(await handlerStatus("/request-password-reset", askForLink), 404);
    // A reset must go through services/password-reset.ts, which decides what
    // the link may do (it removes an unconfirmed invitee's account instead).
    const setPassword = { ...askForLink, body: JSON.stringify({ token: "A".repeat(24), newPassword: `handler-password-${runId}` }) };
    assert.equal(await handlerStatus("/reset-password", setPassword), 404);
    assert.deepEqual(await accountState(userId), { email, verified: false, sessions: 0 });
    assert.equal((await accountEmailFiles("verify-email", userId)).length, 1, "the handler sent a link");
    assert.equal((await accountEmailFiles("reset-password", userId)).length, 0, "the handler sent a reset link");
  });
}
