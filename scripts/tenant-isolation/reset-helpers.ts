// Shared pieces for the password reset checks: asking for a link and using
// it the way the /forgot-password and /reset-password pages do.

import type { FormResult } from "@/lib/form-result";
import { requestPasswordReset, resetPasswordWithToken, type ResetPasswordResult } from "@/services/password-reset";
import { newestResetToken, requestHeadersFrom, runAfterResponseTasks } from "./account-helpers";

export const LINK_NOT_VALID = /This link has expired or is not valid/;

// What the /forgot-password action does, except that the work it hands to
// after() is collected, so a check can see that nothing ran before the answer.
export async function askForReset(email: string, clientLabel: string) {
  const afterResponse: Array<() => Promise<void>> = [];
  const result = await requestPasswordReset({ email }, requestHeadersFrom(clientLabel), (task) => {
    afterResponse.push(task);
  });
  return { result, afterResponse };
}

// Asks for a link, lets the email go out, and returns the token from it.
export async function resetTokenFor(email: string, userId: string, clientLabel: string): Promise<string> {
  const { afterResponse } = await askForReset(email, clientLabel);
  await runAfterResponseTasks(afterResponse);
  return newestResetToken(userId);
}

// What the /reset-password form does: the token from the link plus a new password.
export function resetWith(token: string, password: string, clientLabel: string): Promise<ResetPasswordResult> {
  return resetPasswordWithToken({ token, newPassword: password }, requestHeadersFrom(clientLabel));
}

export function messageOf(result: FormResult | ResetPasswordResult): string {
  return result.ok ? "(it worked)" : (result.errors.message ?? "(no message)");
}
