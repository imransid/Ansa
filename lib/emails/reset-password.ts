import { escapeHtml } from "@/lib/escape-html";
import { describeLinkLifetime, PASSWORD_RESET_LINK_SECONDS } from "@/lib/link-lifetimes";
import type { RenderedEmail } from "./ticket-solved";

type ResetPasswordEmailInput = {
  link: string;
};

// Builds the "reset your password" email. Like the confirmation email it never
// repeats the account's name: whoever signed an address up chose that name,
// and it may not be the person who owns the inbox.
export function renderResetPasswordEmail(input: ResetPasswordEmailInput): RenderedEmail {
  const subject = "Reset your ansa password";
  const lifetime = describeLinkLifetime(PASSWORD_RESET_LINK_SECONDS);
  const text = [
    "Hello,",
    "",
    "Someone, probably you, asked to reset the password of the ansa account for this email address. Open this link to choose a new password:",
    input.link,
    "",
    `The link works once, for ${lifetime}. Choosing a new password logs the account out on every device.`,
    "If you didn't ask for this, you can ignore this email: your password stays as it is.",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="font-family: sans-serif; line-height: 1.5; color: #111;">
    <p>Hello,</p>
    <p>Someone, probably you, asked to reset the password of the ansa account for this email address. Open this link to choose a new password:</p>
    <p><a href="${escapeHtml(input.link)}">Choose a new password</a></p>
    <p>The link works once, for ${lifetime}. Choosing a new password logs the account out on every device.</p>
    <p>If you didn't ask for this, you can ignore this email: your password stays as it is.</p>
  </body>
</html>`;

  return { subject, html, text };
}
