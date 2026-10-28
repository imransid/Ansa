import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CONTENT_FORMAT_LABELS } from "@/lib/content-studio/formats";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/social-platforms";
import type { ContentDraftListItem } from "@/services/content-drafts";
import { DraftStatusBadge } from "./draft-status-badge";

// WHY a fixed layout: the table is exactly as wide as the page, whatever the
// topics say; a long topic is cut with "..." (whole on hover and on its
// page). Narrow screens keep Topic and Status.
export function DraftTable({ drafts }: { drafts: ContentDraftListItem[] }) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead>Topic</TableHead>
          <TableHead className="w-28">Status</TableHead>
          <TableHead className="hidden w-28 md:table-cell">Platform</TableHead>
          <TableHead className="hidden w-40 md:table-cell">Format</TableHead>
          <TableHead className="hidden w-48 lg:table-cell">Last changed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {drafts.map((draft) => (
          <TableRow key={draft.id}>
            <TableCell>
              <Link href={`/cofounder/studio/${draft.id}`} title={draft.topic} className="block truncate font-medium hover:underline">
                {draft.topic}
              </Link>
            </TableCell>
            <TableCell>
              <DraftStatusBadge status={draft.status} />
            </TableCell>
            <TableCell className="hidden truncate md:table-cell">{SOCIAL_PLATFORM_LABELS[draft.platform]}</TableCell>
            <TableCell className="hidden truncate md:table-cell">{CONTENT_FORMAT_LABELS[draft.format]}</TableCell>
            <TableCell className="hidden truncate lg:table-cell" title={draft.updatedByName ?? undefined}>
              <LocalDateTime iso={draft.updatedAt.toISOString()} dateOnly />
              {draft.updatedByName && <span className="text-muted-foreground"> by {draft.updatedByName}</span>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
