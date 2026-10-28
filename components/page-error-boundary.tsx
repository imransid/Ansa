"use client";

import { catchError, type ErrorInfo } from "next/error";
import { SomethingWentWrong } from "@/components/something-went-wrong";

// It takes no props of its own (only the page it wraps).
function PageErrorFallback(_props: Record<string, unknown>, { error, retry }: ErrorInfo) {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6">
      <SomethingWentWrong error={error} retry={retry} />
    </main>
  );
}

// Wraps every signed-in page below the app header (components/app-frame.tsx):
// when a page fails to show, or a button's server action fails (React passes
// that error to the nearest boundary), this replaces the page and the header
// stays, so the person can still get anywhere. Next.js's redirect() and
// notFound() pass through it untouched.
export const PageErrorBoundary = catchError(PageErrorFallback);
