// A failed email delivery is described by a short fixed code only, such as
// Resend's "validation_error" or a file system's "EROFS". Those are logged and
// stored (outgoing_emails.last_error). A provider's message never is: it is
// free text the provider writes, and it can name addresses (Resend's "You can
// only send testing emails to your own email address (...)").
export function toDeliveryErrorCode(code: unknown): string {
  if (typeof code === "string" && /^[A-Za-z0-9_]{1,64}$/.test(code)) {
    return code;
  }
  return "unknown_error";
}
