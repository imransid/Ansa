// Why an image or video wasn't made (step 39): the short code a failed job
// keeps (media_generation_jobs.last_error, a code only, never a service's
// message), and the plain words the pages show for it. Safe to log.

export const generationErrorCodes = [
  // The service in use makes images only (the development stand-in does).
  "no_video_provider",
  // Generation was switched off (or set to another service) after the request.
  "provider_unavailable",
  // The service said no to the prompt (its content rules).
  "provider_refused",
  "provider_failed",
  "provider_timeout",
  // What came back isn't an accepted file of the kind asked for.
  "unexpected_output",
  "output_too_large",
  // The result's address wasn't https on the service's own host, or failed.
  "download_failed",
  "storage_failed",
  // The company's library was full when the result came back (300 files or
  // 500 MB, lib/media/limits.ts): it was not kept.
  "library_full",
  // Runs were cut off (a crash, a deploy, a time limit) as often as allowed.
  "interrupted",
  // Stuck, and replaced by a newer request for the same draft, so it can
  // never attach an older image later (db/media-generation-jobs.ts).
  "superseded",
] as const;
export type GenerationErrorCode = (typeof generationErrorCodes)[number];

const PLAIN_WORDS: Record<GenerationErrorCode, string> = {
  no_video_provider: "The image service in use makes images only, so no video was made.",
  provider_unavailable: "Image generation was switched off after this was asked for, so nothing was made.",
  provider_refused: "The image service refused this prompt (it may break the service's content rules). Try other words.",
  provider_failed: "The image service failed to make it. Try again.",
  provider_timeout: "The image service took too long to answer. Try again.",
  unexpected_output: "The image service sent back something that isn't an image or video of the kind asked for, so nothing was kept.",
  output_too_large: "What the image service sent back was too large to keep.",
  download_failed: "The result couldn't be fetched from the image service, so nothing was kept. Try again.",
  storage_failed: "The result couldn't be stored right now, so nothing was kept. Try again in a few minutes.",
  library_full: "Your media library was full (300 files or 500 MB in all) when it came back, so it wasn't kept. Delete something to make room, then try again.",
  interrupted: "The work was cut off too many times, so it was stopped. Try again.",
  superseded: "It was stuck, and a newer request for the same draft replaced it, so it was stopped.",
};

// The page's words for a stored code. A code this version doesn't know
// (written by a later one) is shown as it is.
export function describeGenerationError(code: string): string {
  return isGenerationErrorCode(code) ? PLAIN_WORDS[code] : `It failed (${code}).`;
}

export function isGenerationErrorCode(code: string): code is GenerationErrorCode {
  return (generationErrorCodes as readonly string[]).includes(code);
}
