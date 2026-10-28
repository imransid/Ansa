import { z } from "zod";
import {
  ACCOUNT_EMAIL_MAX_LENGTH,
  COMPANY_NAME_MAX_LENGTH,
  COMPANY_NAME_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PERSON_NAME_MAX_LENGTH,
} from "@/lib/form-limits";
import { NO_CONTROL_CHARACTERS } from "./control-characters";

// The limits live in lib/form-limits.ts, so the forms can use them too.
export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH };

// Names typed at signup are shown in the app and in emails to teammates.
// Line breaks and other control characters would let someone shape that text
// (a fake first line, a fake header), so they are refused.

// Also part of the sender name of every customer and assignment email
// ("<name> via ansa", buildFromHeader in lib/send-email.ts).
export const companyNameSchema = z
  .string()
  .trim()
  .min(COMPANY_NAME_MIN_LENGTH, `Company name must be at least ${COMPANY_NAME_MIN_LENGTH} characters`)
  .max(COMPANY_NAME_MAX_LENGTH, `Company name must be at most ${COMPANY_NAME_MAX_LENGTH} characters`)
  .regex(NO_CONTROL_CHARACTERS, "Company name can't contain line breaks or other control characters");

// Trim and lowercase first, then check the format, so " Ana@Example.com "
// is accepted and stored as "ana@example.com".
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(ACCOUNT_EMAIL_MAX_LENGTH, "Email is too long")
  .pipe(z.email("Enter a valid email address"));

export const personNameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name")
  .max(PERSON_NAME_MAX_LENGTH, `Name must be at most ${PERSON_NAME_MAX_LENGTH} characters`)
  .regex(NO_CONTROL_CHARACTERS, "Name can't contain line breaks or other control characters");

export const newPasswordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  )
  .max(
    PASSWORD_MAX_LENGTH,
    `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
  );

export const signupSchema = z.object({
  companyName: companyNameSchema,
  name: personNameSchema,
  email: emailSchema,
  password: newPasswordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1, "Enter your password")
    .max(PASSWORD_MAX_LENGTH, "Password is too long"),
});

// Used by the user-create hook in lib/auth.ts. z.object drops every other key,
// so a companyId or role smuggled into the request body is ignored here.
export const newCompanySchema = z.object({
  companyName: companyNameSchema,
});

// The token from an email verification link: a signed JWT (three base64url
// parts). Checking the shape rejects junk before Better Auth looks at it.
export const verificationTokenSchema = z
  .string()
  .max(2000)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

// The /verify-email form: the token from the link plus the account's password.
// Both are needed: the link proves who owns the inbox, the password proves who
// signed up. Without the password, whoever signed up first with someone else's
// address would get their account confirmed by the real owner's click.
export const confirmEmailSchema = z.object({
  token: verificationTokenSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

// What Better Auth puts in a signup verification token (plus iat and exp).
// Tokens for changing an address carry updateTo / requestType, and Better Auth
// logs the clicker in on those, so they are refused here.
export const verificationTokenPayloadSchema = z.object({
  email: z.email(),
  updateTo: z.never().optional(),
  requestType: z.never().optional(),
});

// The token from a password reset link. Better Auth makes it with
// generateId(24): 24 letters and digits. Checking the shape rejects junk
// before Better Auth looks it up.
export const passwordResetTokenSchema = z.string().regex(/^[A-Za-z0-9]{24}$/);

// The /forgot-password form.
export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});

// The /reset-password form: the token from the link plus the new password.
export const resetPasswordSchema = z.object({
  token: passwordResetTokenSchema,
  newPassword: newPasswordSchema,
});
