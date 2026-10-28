import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import type { PlanVersionSummary } from "@/services/marketing-strategy";

type PlanVersionsProps = {
  // The newest ones, newest first.
  versions: PlanVersionSummary[];
  // How many versions there are (they are numbered 1, 2, 3, ...).
  newestVersion: number;
};

// Every version of the plan (step 37), newest first, each opening its own
// page. A long history lists the newest ones; each version's page links to
// the one before it, so every version can still be reached.
export function PlanVersions({ versions, newestVersion }: PlanVersionsProps) {
  if (versions.length === 0) {
    return null;
  }
  return (
    <section className="grid gap-3" aria-labelledby="plan-versions">
      <h2 id="plan-versions" className="text-lg font-semibold">
        All versions
      </h2>
      <ol className="grid gap-2">
        {versions.map((version) => (
          <li key={version.version} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <Link href={`/cofounder/strategy/${version.version}`} className="font-medium underline">
              Version {version.version}
            </Link>
            {version.version === newestVersion && <Badge variant="outline">Current</Badge>}
            <span className="text-muted-foreground">
              <LocalDateTime iso={version.createdAt.toISOString()} dateOnly />, by {version.createdByName ?? "a former teammate"}, from{" "}
              {version.factCount === 1 ? "1 confirmed fact" : `${version.factCount} confirmed facts`}
            </span>
          </li>
        ))}
      </ol>
      {newestVersion > versions.length && (
        <p className="text-sm text-muted-foreground">
          The newest {versions.length} of {newestVersion} versions are listed. Each version&apos;s page links to the one before it.
        </p>
      )}
    </section>
  );
}
