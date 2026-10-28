"use client";

import { Badge } from "@/components/ui/badge";
import type { ContentIssue, DraftContent } from "@/lib/content-rules";
import { measureDraftContent } from "@/lib/content-studio/content-measures";
import { cn } from "@/lib/utils";

type DraftChecksProps = {
  content: DraftContent;
  // checkContentRules on the same content (draft-workspace.tsx).
  issues: ContentIssue[];
  wordsToAvoid: string[];
};

// The platform's rules as someone types (step 38): a count per limit, then
// every problem, the ones that block approval first. The same pure rules
// (lib/content-rules.ts) decide again on the server when an owner approves.
export function DraftChecks({ content, issues, wordsToAvoid }: DraftChecksProps) {
  const ordered = [...issues.filter((issue) => issue.severity === "blocking"), ...issues.filter((issue) => issue.severity === "warning")];
  return (
    <section className="grid gap-3" aria-labelledby="draft-checks">
      <h3 id="draft-checks" className="font-semibold">
        Checks
      </h3>
      <ul className="grid gap-1 text-sm">
        {measureDraftContent(content).map((measure) => (
          <li key={measure.label} className={cn(measure.over && "font-medium text-destructive")}>
            {measure.label}: {measure.used.toLocaleString("en-US")} of {measure.max.toLocaleString("en-US")}
            {measure.unit && ` ${measure.unit}`}
            {measure.note && <span className="text-muted-foreground"> ({measure.note})</span>}
          </li>
        ))}
      </ul>
      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No problems found.</p>
      ) : (
        <ul className="grid gap-2">
          {ordered.map((issue, index) => (
            <li key={`${issue.code}-${index}`} className="flex flex-wrap items-start gap-2 text-sm">
              <Badge variant={issue.severity === "blocking" ? "destructive" : "outline"}>
                {issue.severity === "blocking" ? "Blocks approval" : "Worth a look"}
              </Badge>
              <span className="min-w-0 flex-1 wrap-anywhere">{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground wrap-anywhere">
        {wordsToAvoid.length > 0
          ? `Words to avoid, from your business profile, each looked for as a whole word in any case: ${wordsToAvoid.join(", ")}.`
          : "No words to avoid are confirmed on the Profile page."}
      </p>
    </section>
  );
}
