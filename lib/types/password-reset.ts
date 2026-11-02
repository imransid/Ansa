import type { FormErrors } from "@/lib/form-result";

// What using a reset link did. "account-removed": the link belonged to an
// unconfirmed account that joined a team through an invite, so it removed
// that account instead of setting a password (core/internal/accounts).
export type ResetPasswordResult =
  | { ok: true; outcome: "password-changed" | "account-removed" }
  | { ok: false; errors: FormErrors };
