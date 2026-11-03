"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// A page that waits for what customers send: while the tab is in view it
// asks the server again every `seconds`, so new things show up by
// themselves (the Orders page every 20, step 52; Home, the Inbox and a
// conversation every 5, so ansa's replies and who needs you appear while
// you look). A refresh only brings the server's parts again: what is typed
// in a box and other state in the browser stay. Renders nothing.
export function RefreshEvery({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, seconds * 1000);
    return () => clearInterval(timer);
  }, [router, seconds]);
  return null;
}
