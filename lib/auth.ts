import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { verifyJWT } from "better-auth/crypto";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { isActiveAccount } from "@/lib/active-account";
import { env } from "@/lib/env";
import { PASSWORD_RESET_LINK_SECONDS, VERIFICATION_LINK_SECONDS } from "@/lib/link-lifetimes";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verificationTokenPayloadSchema,
} from "@/lib/validation/auth";
import { createMembershipForNewUser } from "@/services/company-membership";
import { sendExistingAccountEmail, sendVerificationEmail } from "@/services/email-verification";
import { schedulePasswordResetEmail } from "@/services/password-reset-email";

// Better Auth's HTTP handler (/api/auth/*) is deliberately NOT mounted, and a
// check fails if anything mounts it. All auth goes through our server actions
// -> services/signup.ts, services/auth.ts, services/password-reset.ts and
// services/account.ts, which are validated and rate limited; the handler
// would skip all of that.
export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  // These stay off even if the handler is ever mounted.
  // /verify-email would confirm an address from the link alone, with no
  // password: whoever signed up with someone else's address would then get
  // that account confirmed by the real owner's click (see
  // confirmEmailWithPassword in services/auth.ts). /send-verification-email
  // and /request-password-reset would let anyone have links sent to any
  // address, outside our forms and their limits. /reset-password would set a
  // password even where the link must remove an unconfirmed invitee's account
  // instead (services/password-reset.ts).
  // Only the HTTP handler reads this list; auth.api calls still work.
  disabledPaths: ["/verify-email", "/send-verification-email", "/request-password-reset", "/reset-password"],
  // Reset links are stored only as a SHA-256 hash, like invite tokens, so
  // someone reading the database can't use them. (Email confirmation links
  // are signed tokens that are never stored.)
  verification: { storeIdentifier: "hashed" },
  // A login lasts exactly 7 days (Better Auth's default), then you log in
  // again. Sliding sessions mostly moved only the database row: a page can't
  // renew the cookie (Next.js forbids setting cookies while rendering), so the
  // browser was usually logged out on day 7 anyway while the row lived on.
  session: { disableSessionRefresh: true },
  // Do NOT turn on `transaction: true` here. Better Auth would then hold one
  // pool connection for the whole signup while our user-create hook asks the
  // same pool for another. With 10+ signups at once every connection is held,
  // all of them wait for one, and after the pool's 10 seconds
  // (connectionTimeoutMillis, db/client.ts) every one of those signups fails.
  // scripts/tenant-isolation checks for this.
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
    usePlural: true,
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    // No session until the email address is confirmed (step 12).
    // It also makes Better Auth answer a signup for an address that already
    // has an account like a new signup, without changing anything, so the
    // page doesn't say who has an account. The address gets an email instead
    // (onExistingUserSignUp). It is not airtight: signing an address up and
    // then logging in with that password tells "new" ("confirm your email
    // first") from "existed" ("incorrect"). Each such probe creates an
    // account, emails the address and counts against the signup rate limit.
    requireEmailVerification: true,
    onExistingUserSignUp: async ({ user }) => {
      await sendExistingAccountEmail(user);
    },
    // Called only for addresses that have an account, so it only schedules
    // the email for after the response (services/password-reset-email.ts).
    // Better Auth's `url` is ignored: it points at the unmounted handler and
    // carries the token in its path, which would end up in request logs.
    sendResetPassword: async ({ user, token }) => {
      schedulePasswordResetEmail(user, token);
    },
    resetPasswordTokenExpiresIn: PASSWORD_RESET_LINK_SECONDS,
    // A reset ends every login of the account, wherever it is. Better Auth
    // does this without a transaction too (keep `transaction: true` off).
    revokeSessionsOnPasswordReset: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    // An unconfirmed user who logs in with the right password gets a fresh
    // link (login is rate limited, and so are the emails).
    sendOnSignIn: true,
    // A link alone never logs anyone in. Whoever signed up chose the password
    // but never sees the link; whoever owns the inbox sees the link but may
    // not be the one who signed up. Only the two together confirm the address
    // and open a session (services/auth.ts, confirmEmailWithPassword).
    autoSignInAfterVerification: false,
    expiresIn: VERIFICATION_LINK_SECONDS,
    // Better Auth also passes a `url`, but it carries the token in "?token=",
    // which would end up in request logs. We build our own "#" link instead.
    sendVerificationEmail: async ({ user, token }) => {
      await sendVerificationEmail(user, token);
    },
  },
  account: {
    // Rule 1: OAuth tokens are encrypted at rest. Nothing uses OAuth login yet,
    // but this way it is already on the day someone adds it.
    encryptOAuthTokens: true,
  },
  user: {
    additionalFields: {
      // input: false makes Better Auth reject any request that tries to set
      // these fields. Only the hook below fills them in.
      // required: false only means "not required in the request". The database
      // column is NOT NULL, and the hook always sets a value.
      companyId: { type: "string", input: false, required: false },
      role: { type: "string", input: false, required: false },
      // Set when an owner removes this person from the team; only
      // db/team-members.ts sets it. Declared so session.user carries it.
      deactivatedAt: { type: "date", input: false, required: false },
    },
  },
  databaseHooks: {
    session: {
      create: {
        // A removed teammate never gets a new session: not by logging in, not
        // by confirming an address, not by changing a password. The user is
        // read again through Better Auth's own adapter, because the caller's
        // copy may be older than the removal. Returning false stops it.
        before: async (session, context) => {
          const user = await context?.context.internalAdapter.findUserById(session.userId);
          return isActiveAccount(user);
        },
      },
    },
    user: {
      create: {
        // Every new user passes through here, so this is the single place that
        // decides which company a user belongs to. It runs before the user row
        // is inserted, because users.company_id cannot be empty.
        before: async (user, context) => {
          const membership = await createMembershipForNewUser(
            context?.body,
            user.email,
          );
          return {
            data: {
              ...user,
              companyId: membership.companyId,
              role: membership.role,
            },
          };
        },
      },
    },
  },
  // At "info" level Better Auth logs email addresses. Keep logs free of them.
  logger: { level: "warn" },
  // nextCookies must stay the last plugin. It lets server actions set the session cookie.
  plugins: [nextCookies()],
});

// Reads the email address out of a verification link's token. Returns null
// when the token is forged, expired, or not a plain signup token. It checks
// the signature with our secret, as auth.api.verifyEmail does, and that call
// checks the token again before anything is confirmed.
export async function readEmailFromVerificationToken(token: string): Promise<string | null> {
  const context = await auth.$context;
  const payload = await verifyJWT(token, context.secret);
  const parsed = verificationTokenPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.email : null;
}

// Says whether this is the password of the account with this email, checked
// the way Better Auth's own login checks it (api/routes/sign-in.mjs), but
// without logging in. With no such account it still hashes the password, so
// a miss takes as long as a wrong password.
export async function isCorrectPasswordForEmail(email: string, password: string): Promise<boolean> {
  const context = await auth.$context;
  const found = await context.internalAdapter.findUserByEmail(email, { includeAccounts: true });
  const credentialAccount = found?.accounts.find(
    (account) => account.providerId === "credential" && account.accountId === found.user.id,
  );
  if (!credentialAccount?.password) {
    await context.password.hash(password);
    return false;
  }
  return context.password.verify({ hash: credentialAccount.password, password });
}

// Takes as long as one password check without checking anything. Used when a
// link is bad, so that answer doesn't come back faster than a wrong password.
export async function spendPasswordCheckTime(password: string): Promise<void> {
  const context = await auth.$context;
  await context.password.hash(password);
}
