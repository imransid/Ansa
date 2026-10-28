"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// How often the page asks again, and for how long at most: a run never
// lasts longer than its page's 300 seconds.
const REFRESH_EVERY_MS = 3_000;
const REFRESH_FOR_MS = 5 * 60_000;

// While something on the page is still being done after its answer (an
// image or video being made, step 39; a post going out, step 41), the page
// asks the server again every few seconds, so the result shows up by
// itself. It stops once nothing is waiting, or after five minutes. Renders
// nothing.
export function RefreshWhilePending({ isPending }: { isPending: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!isPending) {
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt > REFRESH_FOR_MS) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, REFRESH_EVERY_MS);
    return () => clearInterval(timer);
  }, [isPending, router]);
  return null;
}
