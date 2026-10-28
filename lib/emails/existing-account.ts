import { escapeHtml } from "@/lib/escape-html";
import type { RenderedEmail } from "./ticket-solved";

type ExistingAccountEmailInput = {
  loginLink: string;
  resetPasswordLink: string;
};

// Builds the email sent when someone signs up (or joins a team) with an
// address that already has an ansa account. The signup page itself answers as
// if the signup worked, so the page never reveals who has an account; only the
// owner of the inbox learns it, from this email. Removed teammates get it too
// (skipping them would make their signups answer faster), so it says why their
// login no longer works.
export function renderExistingAccountEmail(input: ExistingAccountEmailInput): RenderedEmail {
  const subject = "You already have an ansa account";
  const text = [
    "Hello,",
    "",
    "Someone, probably you, just tried to sign up for ansa with this email address. It already has an ansa account, so nothing was changed.",
    "",
    "To use your account, log in:",
    input.loginLink,
    "",
    "If you signed up before but never confirmed your address, log in with the password you chose then, and we'll email you a new confirmation link.",
    "",
    "Forgot your password, or never chose one yourself? Reset it here:",
    input.resetPasswordLink,
    "",
    "One email address can belong to one company only. To join another company's team, ask its owner to invite a different address.",
    "",
    "If an owner removed you from your team, this account can no longer log in, and the address can't be used for another account.",
    "",
    "If you didn't try to sign up, you can ignore this email.",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="font-family: sans-serif; line-height: 1.5; color: #111;">
    <p>Hello,</p>
    <p>Someone, probably you, just tried to sign up for ansa with this email address. It already has an ansa account, so nothing was changed.</p>
    <p><a href="${escapeHtml(input.loginLink)}">Log in to your account</a></p>
    <p>If you signed up before but never confirmed your address, log in with the password you chose then, and we'll email you a new confirmation link.</p>
    <p>Forgot your password, or never chose one yourself? <a href="${escapeHtml(input.resetPasswordLink)}">Reset your password</a></p>
    <p>One email address can belong to one company only. To join another company's team, ask its owner to invite a different address.</p>
    <p>If an owner removed you from your team, this account can no longer log in, and the address can't be used for another account.</p>
    <p>If you didn't try to sign up, you can ignore this email.</p>
  </body>
</html>`;

  return { subject, html, text };
}
