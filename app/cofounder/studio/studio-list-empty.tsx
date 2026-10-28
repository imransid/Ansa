import type { ReactNode } from "react";
import Link from "next/link";
import { buildListUrl } from "@/lib/pagination";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/social-platforms";
import type { ContentDraftListQuery } from "@/lib/validation/list-queries";
import type { ContentDraftStatusCounts } from "@/services/content-drafts";

type StudioListEmptyProps = {
  query: ContentDraftListQuery;
  page: number;
  // The counts on the platform picked.
  counts: ContentDraftStatusCounts;
  // How many drafts the company has, whatever the filters.
  totalDrafts: number;
};

// Shown instead of the table when the list on screen has no rows. A company
// without any draft first learns what the studio is for.
export function StudioListEmpty({ query, page, counts, totalDrafts }: StudioListEmptyProps) {
  if (totalDrafts === 0) {
    return <FirstDraft />;
  }
  if (page > 1) {
    return (
      <EmptyBox>
        Nothing on this page.{" "}
        <Link href={buildListUrl("/cofounder/studio", { status: query.status, platform: query.platform })} className="underline">
          Go to the first page
        </Link>
      </EmptyBox>
    );
  }
  return (
    <EmptyBox>
      {describeEmptyList(query, counts)}{" "}
      {query.platform !== "all" && (
        <Link href={buildListUrl("/cofounder/studio", { status: query.status })} className="underline">
          Every platform
        </Link>
      )}
    </EmptyBox>
  );
}

function describeEmptyList(query: ContentDraftListQuery, counts: ContentDraftStatusCounts): string {
  const where = query.platform === "all" ? "" : ` for ${SOCIAL_PLATFORM_LABELS[query.platform]}`;
  switch (query.status) {
    case "current":
      return counts.archived > 0 ? `Every draft${where} is archived.` : `No drafts${where} yet.`;
    case "idea":
      return `No ideas${where} waiting to be written.`;
    case "draft":
      return `No drafts${where} waiting for an owner's approval.`;
    case "approved":
      return `No approved drafts${where}: a draft is approved only once an owner reads and approves it.`;
    case "rejected":
      return `No rejected drafts${where}.`;
    case "scheduled":
      return `No drafts${where} scheduled: an owner schedules an approved draft from its page.`;
    case "published":
      return `Nothing${where} has gone out yet.`;
    case "failed":
      return `No drafts${where} with a post that didn't go out.`;
    case "archived":
      return `No archived drafts${where}.`;
  }
}

function FirstDraft() {
  return (
    <div className="grid gap-3 rounded-lg border p-6 text-sm">
      <p className="font-medium">Write your first post.</p>
      <p className="text-muted-foreground">
        Pick a platform, a format and a topic, and the AI writes a post for that platform from the facts confirmed on the{" "}
        <Link href="/cofounder/profile" className="underline">
          Profile page
        </Link>
        , in your brand voice, within the content pillars and campaigns of your{" "}
        <Link href="/cofounder/strategy" className="underline">
          marketing plan
        </Link>
        . Or start a blank draft and write it yourself. Either way an owner approves it before it can be published.
      </p>
      <p>
        <Link href="/cofounder/studio/new" className="underline">
          New draft
        </Link>
      </p>
    </div>
  );
}

function EmptyBox({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border p-6 text-center text-muted-foreground">{children}</p>;
}
