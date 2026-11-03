import Link from "next/link";
import { packageNotice } from "@/lib/packages";
import type { PackageStatus } from "@/lib/types/packages";

// What Home says about the package (step 57, owners only): the free
// trial's days or its end, and AI replies or call minutes running out,
// with the way to Billing. Nothing when all is well.
export function PackageNotice({ status }: { status: PackageStatus | null }) {
  const notice = status ? packageNotice(status, new Date()) : null;
  if (!notice) {
    return null;
  }
  return (
    <p role="status" className={notice.tone === "attention" ? "rounded-xl bg-attention-surface px-4 py-3 text-sm" : "text-sm text-muted-foreground"}>
      {notice.text}{" "}
      <Link href="/billing" className="font-medium underline">
        See packages
      </Link>
    </p>
  );
}
