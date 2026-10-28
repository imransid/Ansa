import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// How adapters/claude.ts names a request that failed (the class name only,
// never the message: it can quote the answer). It makes no request itself:
// adapters/claude.ts stays the only file that talks to Anthropic.

// The SDK's errors by the names the logs, the call page and
// docs/going-live.md use ("AuthenticationError": a wrong or revoked key).
// WHY not error.constructor.name: the production build minifies the
// server's code, and its class names become letters ("m"). A subclass comes
// before the class it extends.
const SDK_ERROR_NAMES: [string, new (...args: never[]) => Error][] = [
  ["APIConnectionTimeoutError", Anthropic.APIConnectionTimeoutError],
  ["APIConnectionError", Anthropic.APIConnectionError],
  ["APIUserAbortError", Anthropic.APIUserAbortError],
  ["BadRequestError", Anthropic.BadRequestError],
  ["AuthenticationError", Anthropic.AuthenticationError],
  ["PermissionDeniedError", Anthropic.PermissionDeniedError],
  ["NotFoundError", Anthropic.NotFoundError],
  ["ConflictError", Anthropic.ConflictError],
  ["UnprocessableEntityError", Anthropic.UnprocessableEntityError],
  ["RateLimitError", Anthropic.RateLimitError],
  ["InternalServerError", Anthropic.InternalServerError],
  ["APIError", Anthropic.APIError],
  ["AnthropicError", Anthropic.AnthropicError],
];

// The class of what askClaude caught: the SDK's own name for its errors,
// any other error's class (a TypeError keeps its name when minified).
export function nameOfError(error: unknown): string {
  const sdkError = SDK_ERROR_NAMES.find(([, errorClass]) => error instanceof errorClass);
  if (sdkError) {
    return sdkError[0];
  }
  return error instanceof Error ? error.constructor.name : "unknown";
}
