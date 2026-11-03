import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { daysLeftWords, packageNotice } from "@/lib/packages";
import type { PackageStatus } from "@/lib/types/packages";

// What Home says about the package (step 57, owners only): when the free
// trial ends (a date in the viewer's own time) or that it ended, and AI
// replies or call minutes running out, with the way to Billing. Nothing
// when all is well.
export function PackageNotice({ status }: { status: PackageStatus | null }) {
  const notice = status ? packageNotice(status, new Date()) : null;
  if (!notice) {
    return null;
  }
  return (
    <p role="status" className={notice.tone === "attention" ? "rounded-xl bg-attention-surface px-4 py-3 text-sm" : "text-sm text-muted-foreground"}>
      {notice.trialEnd && (
        <>
          Your free trial ends on <LocalDateTime iso={notice.trialEnd.at.toISOString()} /> ({daysLeftWords(notice.trialEnd.daysLeft)}).{" "}
        </>
      )}
      {notice.text}{" "}
      <Link href="/billing" className="font-medium underline">
        See packages
      </Link>
    </p>
  );
}
