"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

// How often the page asks again (unless it names its own pace), and for how
// long at most: a run never lasts longer than its page's 300 seconds.
const REFRESH_EVERY_MS = 3_000;
const REFRESH_FOR_MS = 5 * 60_000;

type RefreshWhilePendingProps = {
  isPending: boolean;
  everyMs?: number;
};

// While something on the page is still being done after its answer (an
// image or video being made, step 39; a post going out, step 41; a solved
// request's email), the page asks the server again every few seconds, so
// the result shows up by itself. It stops once nothing is waiting, or after
// five minutes. Renders nothing.
//
// WHY the next refresh waits for the last one (as in refresh-every.tsx):
// Next's router runs refreshes and server actions one at a time, so
// refreshes started while a slow one runs would pile up in front of any
// button pressed meanwhile.
export function RefreshWhilePending({ isPending, everyMs = REFRESH_EVERY_MS }: RefreshWhilePendingProps) {
  const router = useRouter();
  // True from the start of a refresh until the page it brought is shown.
  const [isRefreshing, startRefresh] = useTransition();
  // When this wait began (null: nothing is waiting).
  const waitingSince = useRef<number | null>(null);
  useEffect(() => {
    if (!isPending) {
      waitingSince.current = null;
      return;
    }
    waitingSince.current ??= Date.now();
    if (isRefreshing || Date.now() - waitingSince.current > REFRESH_FOR_MS) {
      return;
    }
    const timer = setTimeout(() => startRefresh(() => router.refresh()), everyMs);
    return () => clearTimeout(timer);
  }, [isPending, isRefreshing, everyMs, router]);
  return null;
}
