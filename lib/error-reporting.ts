import { describeErrorSafely, safeStackFrames } from "./safe-error-logging";

export type RequestErrorContext = {
  method: string;
  // The route pattern (e.g. /tickets/[ticketNumber]), never the real URL.
  routePath: string;
  routeType: string;
};

// Reports a request that failed on the server: one JSON line in the server
// logs, with no message and no URL (Rule 1). The hosting platform's logs are
// the error monitor for now; when a monitoring service is chosen, send this
// same object to it from here (through an adapter).
export function reportRequestError(error: unknown, context: RequestErrorContext): void {
  const report = {
    event: "request_error",
    error: describeErrorSafely(error),
    frames: safeStackFrames(error),
    ...context,
  };
  console.error(JSON.stringify(report));
}
