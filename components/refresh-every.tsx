"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// How often an open page asks the server again.
const REFRESH_EVERY_MS = 20_000;

// A page that waits for what customers send (the Orders page, step 52):
// while the tab is in view it asks the server again every 20 seconds, so a
// new order shows up by itself. Renders nothing.
export function RefreshEvery() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }, REFRESH_EVERY_MS);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
