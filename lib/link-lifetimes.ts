// How long the links we email work. Core enforces both and says so in its
// emails (linkLifetime in core/internal/accounts: one hour each); every page
// that tells people how long reads it from here, so the two must agree. No
// "server-only": the forgot-password form shows it in the browser.
export const VERIFICATION_LINK_SECONDS = 60 * 60;
export const PASSWORD_RESET_LINK_SECONDS = 60 * 60;

// A link's lifetime as words for a sentence: "one hour", "2 hours", "30 minutes".
export function describeLinkLifetime(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return hours === 1 ? "one hour" : `${hours} hours`;
  }
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? "one minute" : `${minutes} minutes`;
}
