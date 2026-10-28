import { FilterLinks } from "@/components/filter-links";
import { buildListUrl } from "@/lib/pagination";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/social-platforms";
import {
  contentDraftPlatformFilters,
  contentDraftStatusFilters,
  type ContentDraftListQuery,
  type ContentDraftPlatformFilter,
  type ContentDraftStatusFilter,
} from "@/lib/validation/list-queries";
import type { ContentDraftStatusCounts } from "@/services/content-drafts";

const STATUS_LABELS: Record<ContentDraftStatusFilter, string> = {
  current: "Current",
  idea: "Ideas",
  draft: "Drafts",
  approved: "Approved",
  rejected: "Rejected",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Publishing problems",
  archived: "Archived",
};

function platformLabel(platform: ContentDraftPlatformFilter): string {
  return platform === "all" ? "Every platform" : SOCIAL_PLATFORM_LABELS[platform];
}

// The studio list's filters (step 38): by status, with how many drafts each
// holds on the platform picked, and by platform. Each row keeps the other's
// choice. "Current" is everything but the archived drafts.
export function StudioFilters({ query, counts }: { query: ContentDraftListQuery; counts: ContentDraftStatusCounts }) {
  const statusLinks = contentDraftStatusFilters.map((status) => ({
    label: `${STATUS_LABELS[status]} (${counts[status]})`,
    href: buildListUrl("/cofounder/studio", { status, platform: query.platform }),
    isCurrent: status === query.status,
    // Drafts wait for an owner: nothing is published until one approves.
    // A post that didn't go out (or may not have) waits for one too.
    needsAttention: (status === "draft" && counts.draft > 0) || (status === "failed" && counts.failed > 0),
  }));
  const platformLinks = contentDraftPlatformFilters.map((platform) => ({
    label: platformLabel(platform),
    href: buildListUrl("/cofounder/studio", { status: query.status, platform }),
    isCurrent: platform === query.platform,
  }));

  return (
    <div className="grid gap-2">
      <FilterLinks label="Draft status" links={statusLinks} />
      <FilterLinks label="Platform" links={platformLinks} />
    </div>
  );
}
