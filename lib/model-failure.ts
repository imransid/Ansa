import type { ModelResult } from "@/lib/model-request";

// A class name like "AuthenticationError" or "APIConnectionTimeoutError".
const CLASS_NAME = /^[A-Za-z0-9_]{1,64}$/;

// Why asking Claude gave no answer, as a short fixed word that is safe to log
// and store (step 27): the SDK error's class name ("AuthenticationError",
// "NotFoundError" for a wrong model name, "RateLimitError"), or "refused",
// "truncated", "unexpected_stop". Never an error message: those can quote the
// answer. null when Claude answered or was not asked (no API key).
export function describeModelFailure(result: ModelResult): string | null {
  switch (result.kind) {
    case "error":
      return CLASS_NAME.test(result.errorName) ? result.errorName : "UnknownError";
    case "refused":
      return "refused";
    case "truncated":
      return "truncated";
    case "unexpected-stop":
      return "unexpected_stop";
    case "ok":
    case "unavailable":
      return null;
  }
}
