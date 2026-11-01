import Link from "next/link";
import type { FirstRunHints } from "@/services/dashboard";

// Points anyone who handles no kind of request to the Team page, where they
// pick theirs (step 32): routing never gives them one otherwise. The Setup
// steps' reminder that was here gave way to Home's "Getting started" (the
// "easy to use" pass of 2026-11-01); the Setup page still lists them.
export function FirstRunNotices({ hints }: { hints: FirstRunHints }) {
  if (!hints.handlesNoCategory) {
    return null;
  }
  return (
    <p className="rounded-xl bg-attention-surface px-4 py-3 text-sm">
      You don&apos;t handle any kind of request yet, so none come to you by themselves.{" "}
      <Link href="/team" className="font-medium underline">
        Pick what you handle
      </Link>
    </p>
  );
}
