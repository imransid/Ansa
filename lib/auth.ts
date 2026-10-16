import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { env } from "@/lib/env";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/validation/auth";
import { createMembershipForNewUser } from "@/services/company-membership";
import { sendVerificationEmail, VERIFICATION_LINK_SECONDS } from "@/services/email-verification";

// Better Auth's HTTP handler (/api/auth/*) is deliberately NOT mounted.
// All auth goes through our server actions -> services/auth.ts, which are
// validated and rate limited. If you ever mount the handler, rate limit it too.
export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  // Do NOT turn on `transaction: true` here. Better Auth would then hold one
  // pool connection for the whole signup while our user-create hook asks the
  // same pool for another. With 10+ signups at once every connection is held
  // and all of them wait forever. scripts/tenant-isolation checks for this.
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
    usePlural: true,
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    // No session until the email address is confirmed (step 12). Also makes
    // signup with an already-used email look like a normal signup, so the
    // form can't be used to find out who has an account.
    requireEmailVerification: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    // An unconfirmed user who tries to log in gets a fresh link (login is rate limited).
    sendOnSignIn: true,
    // Confirming the email logs the user in.
    autoSignInAfterVerification: true,
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
    },
  },
  databaseHooks: {
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
