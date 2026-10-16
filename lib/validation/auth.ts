import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const companyNameSchema = z
  .string()
  .trim()
  .min(2, "Company name must be at least 2 characters")
  .max(100, "Company name must be at most 100 characters");

// Trim and lowercase first, then check the format, so " Ana@Example.com "
// is accepted and stored as "ana@example.com".
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email is too long")
  .pipe(z.email("Enter a valid email address"));

export const personNameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name")
  .max(100, "Name must be at most 100 characters");

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
