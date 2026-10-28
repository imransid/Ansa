// How long the links we email work. Better Auth enforces both (lib/auth.ts),
// and every email and page that tells people how long reads it from here, so
// the words can never drift from the real lifetime. No "server-only": the
// forgot-password form shows it in the browser.
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
