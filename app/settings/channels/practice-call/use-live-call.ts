"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { endPracticeCallAction } from "@/app/actions/phone";

export type Call = { id: string; conversationId: string };

// The practice call that is live, for what comes back after a hang-up: an
// answer to a call that is over is dropped (never heard or shown). Leaving
// the page hangs up, so no call is left live: always for another page of
// ansa, at best for a reload or a closed tab (the browser may cut the
// request off; the same number's next call then ends it). A page the
// browser keeps for its back button shows the call as ended (onHidden).
export function useLiveCall(onHidden: (ended: Call) => void) {
  const live = useRef<Call | null>(null);
  const pageLeft = useRef(false);
  const showEnded = useEffectEvent(onHidden);

  useEffect(() => {
    pageLeft.current = false;
    function hangUpOnLeaving() {
      const left = live.current;
      live.current = null;
      window.speechSynthesis?.cancel();
      if (left) {
        void endPracticeCallAction({ callId: left.id });
      }
      return left;
    }
    function onPageHide() {
      const left = hangUpOnLeaving();
      if (left) {
        showEnded(left);
      }
    }
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      pageLeft.current = true;
      hangUpOnLeaving();
    };
  }, []);

  return {
    // The live call, or null.
    current: () => live.current,
    // A call ansa picked up is live, unless the page was left meanwhile:
    // then nobody is on it, and it hangs up at once (false).
    begin: (call: Call) => {
      if (pageLeft.current) {
        void endPracticeCallAction({ callId: call.id });
        return false;
      }
      live.current = call;
      return true;
    },
    // The call is over (hung up, or core says so): what comes back for it is dropped.
    end: () => {
      const ended = live.current;
      live.current = null;
      return ended;
    },
  };
}
