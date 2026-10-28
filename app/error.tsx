"use client";

import { SomethingWentWrong } from "@/components/something-went-wrong";

type ErrorPageProps = {
  error: unknown;
  retry: () => void;
};

// Shown instead of a page that failed: the log in, sign up and other pages
// outside the app (the app's own pages have a boundary below their header,
// components/page-error-boundary.tsx). The root layout stays. Without this,
// Next.js would show its own unstyled screen with no way back.
export default function ErrorPage({ error, retry }: ErrorPageProps) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      {/* An error page can't export metadata; React puts this in <head>. */}
      <title>Something went wrong - ansa</title>
      <SomethingWentWrong error={error} retry={retry} />
    </main>
  );
}
