// Email verification checks (step 12): signup gives no session and sends a
// link with the token after "#", login is refused until confirmed, only a
// genuine, unexpired link confirms, and nothing about it is logged.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createEmailVerificationToken } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { verificationTokenSchema } from "@/lib/validation/auth";
import { captureConsole, check, runId, testEmail, testPassword } from "./helpers";

const OUTBOX = path.join(process.cwd(), ".dev-emails");

async function verificationFilesFor(userId: string): Promise<string[]> {
  const files = await readdir(OUTBOX).catch(() => [] as string[]);
  return files.filter((file) => file.includes(`verify-email-${userId}-`));
}

async function signUpUnverified(label: string) {
  const email = testEmail(label);
  const body = { name: `Verify ${label}`, email, password: testPassword, companyName: `Isolation test ${label} ${runId}` };
  const result = await auth.api.signUpEmail({ body });
  return { email, userId: result.user.id, sessionToken: result.token };
}

async function isVerified(userId: string): Promise<boolean> {
  const [user] = await db.select({ verified: users.emailVerified }).from(users).where(eq(users.id, userId));
  return user.verified;
}

export async function runVerificationChecks() {
  await check("verification: signup gives no session and emails a link with the token after #", async () => {
    const { result, logs } = await captureConsole(() => signUpUnverified("verify-new"));
    assert.equal(result.sessionToken, null, "signup returned a session");
    assert.equal(await isVerified(result.userId), false);
    const files = await verificationFilesFor(result.userId);
    assert.equal(files.length, 1, "no verification email was written");
    const email = await readFile(path.join(OUTBOX, files[0]), "utf8");
    assert.ok(email.includes(`${env.BETTER_AUTH_URL}/verify-email#`));
    assert.ok(!email.includes("token="), "the token is in a query string");
    assert.ok(logs.every((line) => !line.includes(result.email)), "the address was logged");
  });

  await check("verification: login is refused until confirmed, and sends a fresh link", async () => {
    const { email, userId } = await signUpUnverified("verify-login");
    await assert.rejects(auth.api.signInEmail({ body: { email, password: testPassword } }), (error: unknown) => {
      return typeof error === "object" && error !== null && "body" in error && (error as { body?: { code?: string } }).body?.code === "EMAIL_NOT_VERIFIED";
    });
    assert.equal((await verificationFilesFor(userId)).length, 2, "no fresh link on login");
  });

  await check("verification: a genuine link confirms the address and allows login", async () => {
    const { email, userId } = await signUpUnverified("verify-ok");
    const token = await createEmailVerificationToken(env.BETTER_AUTH_SECRET, email, undefined, 3600);
    assert.ok(verificationTokenSchema.safeParse(token).success, "our shape check rejects a real token");
    await auth.api.verifyEmail({ query: { token } });
    assert.equal(await isVerified(userId), true);
    const login = await auth.api.signInEmail({ body: { email, password: testPassword } });
    assert.ok(login.token, "no session after confirming");
  });

  await check("verification: tampered, wrong-secret and expired links are refused", async () => {
    const { email, userId } = await signUpUnverified("verify-bad");
    const genuine = await createEmailVerificationToken(env.BETTER_AUTH_SECRET, email, undefined, 3600);
    const [header, payload, signature] = genuine.split(".");
    const otherEmail = Buffer.from(JSON.stringify({ email: "someone-else@example.test" })).toString("base64url");
    const badTokens = [
      `${header}.${otherEmail}.${signature}`, // payload swapped, signature no longer matches
      await createEmailVerificationToken("x".repeat(40), email, undefined, 3600), // wrong secret
      await createEmailVerificationToken(env.BETTER_AUTH_SECRET, email, undefined, -60), // expired
      `${header}.${payload}.${"A".repeat(signature.length)}`, // signature replaced
    ];
    for (const token of badTokens) {
      await assert.rejects(auth.api.verifyEmail({ query: { token } }));
    }
    assert.equal(await isVerified(userId), false, "a bad link confirmed the address");
  });

  await check("verification: the token shape check rejects junk before Better Auth sees it", async () => {
    for (const junk of ["", "abc", "a.b", "a.b.c.d", "a.b.<script>", "x".repeat(2001)]) {
      assert.equal(verificationTokenSchema.safeParse(junk).success, false, `accepted "${junk.slice(0, 20)}"`);
    }
  });
}
