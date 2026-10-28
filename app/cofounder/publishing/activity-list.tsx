import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { describeActivity } from "@/lib/publishing/activity-text";
import type { ActivityListItem } from "@/services/publishing-pages";

type ActivityListProps = {
  entries: ActivityListItem[];
  // On the queue page each entry about a draft links to it; on the draft's own page it doesn't.
  linkDrafts: boolean;
  emptyText: string;
};

// The Co-Founder's activity log (step 41), newest first: who did what to
// the accounts, drafts, posts, rules and plans, and when, in plain words.
export function ActivityList({ entries, linkDrafts, emptyText }: ActivityListProps) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <ol className="grid gap-2 text-sm">
      {entries.map((entry) => (
        <li key={entry.id} className="grid gap-0.5 rounded-lg border p-3">
          <span className="text-xs text-muted-foreground">
            <LocalDateTime iso={entry.createdAt.toISOString()} />
          </span>
          <span className="wrap-anywhere">{describeActivity(entry)}</span>
          {linkDrafts && entry.draftId && (
            <Link href={`/cofounder/studio/${entry.draftId}`} className="justify-self-start text-xs underline">
              Open the draft
            </Link>
          )}
        </li>
      ))}
    </ol>
  );
}
