import { escapeHtml } from "@/lib/escape-html";
import type { RenderedEmail } from "./ticket-solved";

type VerifyEmailInput = {
  name: string;
  link: string;
};

// Builds the "confirm your email address" email sent after signup (and again
// when an unconfirmed user tries to log in).
export function renderVerifyEmail(input: VerifyEmailInput): RenderedEmail {
  const subject = "Confirm your email address";
  const text = [
    `Hi ${input.name},`,
    "",
    "Confirm your email address to finish setting up your ansa account:",
    input.link,
    "",
    "The link works for one hour. If you didn't sign up, you can ignore this email.",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="font-family: sans-serif; line-height: 1.5; color: #111;">
    <p>Hi ${escapeHtml(input.name)},</p>
    <p>Confirm your email address to finish setting up your ansa account:</p>
    <p><a href="${escapeHtml(input.link)}">Confirm my email address</a></p>
    <p>The link works for one hour. If you didn't sign up, you can ignore this email.</p>
  </body>
</html>`;

  return { subject, html, text };
}
