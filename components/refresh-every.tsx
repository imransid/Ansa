"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

// A page that waits for what customers send: while the tab is in view it
// asks the server again every `seconds`, so new things show up by
// themselves (the Orders page every 20, step 52; Home, the Inbox and a
// conversation every 5, so ansa's replies and who needs you appear while
// you look). A refresh only brings the server's parts again: what is typed
// in a box and other state in the browser stay. Renders nothing.
//
// WHY the next refresh waits for the last one (not setInterval): Next's
// router runs refreshes and a button's server action one at a time, in
// order. On a busy computer a page can take longer than `seconds` to come
// back, and refreshes started meanwhile piled up in front of the action of
// any button pressed then.
export function RefreshEvery({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  // True from the start of a refresh until the page it brought is shown.
  const [isRefreshing, startRefresh] = useTransition();
  useEffect(() => {
    if (isRefreshing) {
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    // A hidden tab asks nothing: it looks again after the same wait.
    function refreshAfterTheWait() {
      timer = setTimeout(() => {
        if (document.visibilityState === "visible") {
          startRefresh(() => router.refresh());
        } else {
          refreshAfterTheWait();
        }
      }, seconds * 1000);
    }
    refreshAfterTheWait();
    return () => clearTimeout(timer);
  }, [isRefreshing, router, seconds]);
  return null;
}
