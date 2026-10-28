import { escapeHtml } from "@/lib/escape-html";
import { describeLinkLifetime, VERIFICATION_LINK_SECONDS } from "@/lib/link-lifetimes";
import type { RenderedEmail } from "./ticket-solved";

type VerifyEmailInput = {
  link: string;
};

// Builds the "confirm your email address" email sent after signup (and again
// when an unconfirmed user tries to log in).
// It never repeats the name typed at signup: anyone can sign up any address,
// so that name would put a stranger's words at the top of our email.
export function renderVerifyEmail(input: VerifyEmailInput): RenderedEmail {
  const subject = "Confirm your email address";
  const lifetime = describeLinkLifetime(VERIFICATION_LINK_SECONDS);
  const text = [
    "Hello,",
    "",
    "Confirm your email address to finish setting up your ansa account. Open this link and enter your ansa password:",
    input.link,
    "",
    `The link works for ${lifetime}.`,
    "If you didn't sign up for ansa, you can ignore this email: without the password, the link does nothing.",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="font-family: sans-serif; line-height: 1.5; color: #111;">
    <p>Hello,</p>
    <p>Confirm your email address to finish setting up your ansa account. Open this link and enter your ansa password:</p>
    <p><a href="${escapeHtml(input.link)}">Confirm my email address</a></p>
    <p>The link works for ${lifetime}.</p>
    <p>If you didn't sign up for ansa, you can ignore this email: without the password, the link does nothing.</p>
  </body>
</html>`;

  return { subject, html, text };
}
