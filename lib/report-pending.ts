import { useEffect } from "react";

// Tells onPendingChange when a form's action starts (true) and when it ends
// or the form goes away (false). WHY the cleanup says "ended": a button can
// leave the page in the same render its action finishes in (the content
// studio's Regenerate, step 38), and a page holding still until then must
// always hear about the end.
export function useReportPending(isPending: boolean, onPendingChange?: (isPending: boolean) => void): void {
  useEffect(() => {
    if (!isPending || !onPendingChange) {
      return;
    }
    onPendingChange(true);
    return () => onPendingChange(false);
  }, [isPending, onPendingChange]);
}
