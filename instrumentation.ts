import type { Instrumentation } from "next";

// Runs once when the server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installSafeErrorLogging } = await import("./lib/safe-error-logging");
    installSafeErrorLogging();
    const { warnAboutDevStandIns } = await import("./lib/production-warnings");
    warnAboutDevStandIns();
  }
}

// Called by Next.js for every error thrown while handling a request.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { reportRequestError } = await import("./lib/error-reporting");
  reportRequestError(error, { method: request.method, routePath: context.routePath, routeType: context.routeType });
};
