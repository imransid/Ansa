"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

type SomethingWentWrongProps = {
  error: unknown;
  // Next.js's retry: loads the page again and shows it if that works.
  retry: () => void;
};

// What every error screen says: app/error.tsx, app/global-error.tsx and the
// app pages' own boundary (components/page-error-boundary.tsx). Never the
// error's message: it can quote customer data or a setting. The reference is
// the digest that the server's log line for the error carries
// ("event":"request_error"), so ansa can find what happened.
export function SomethingWentWrong({ error, retry }: SomethingWentWrongProps) {
  const reference = readErrorReference(error);
  return (
    <div role="alert" className="grid max-w-md gap-4">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        This page couldn&apos;t be shown, or what you just did didn&apos;t finish. If you were saving something, check
        whether it was saved before you do it again.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => retry()}>
          Try again
        </Button>
        <Link href="/dashboard" className="text-sm underline">
          Go to your tickets
        </Link>
      </div>
      {reference && <p className="text-xs text-muted-foreground">Reference for ansa support: {reference}</p>}
    </div>
  );
}

// The digest Next.js gives an error from the server: a short id, never data.
// Errors from the browser itself have none.
function readErrorReference(error: unknown): string | null {
  if (!(error instanceof Error) || !("digest" in error)) {
    return null;
  }
  const digest = error.digest;
  return typeof digest === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(digest) ? digest : null;
}
