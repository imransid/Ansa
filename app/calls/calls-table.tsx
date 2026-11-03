import type { ReactNode } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LocalDateTime } from "@/components/local-date-time";
import { describeEndedReason } from "@/lib/call-ended-reason";
import { formatCallDuration } from "@/lib/format-duration";
import { buildListUrl } from "@/lib/pagination";
import type { CallListItem } from "@/lib/types/calls";
import type { CallListQuery, CallOutcomeFilter } from "@/lib/validation/list-queries";
import { DecisionBadge } from "./decision-badge";

// What an empty filter says (step 29).
const EMPTY_FILTER_TEXT: Record<CallOutcomeFilter, string> = {
  all: "No calls here yet.",
  solved: "No calls the AI solved.",
  needs_human: "No calls that needed a human.",
  stuck: "No stuck calls.",
};

type CallsTableProps = {
  calls: CallListItem[];
  page: number;
  query: CallListQuery;
};

export function CallsTable({ calls, page, query }: CallsTableProps) {
  if (calls.length === 0) {
    return <CallListEmpty page={page} query={query} />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Started</TableHead>
          <TableHead>Caller</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>How it ended</TableHead>
          <TableHead>AI decision</TableHead>
          <TableHead>
            <span className="sr-only">Links</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {calls.map((call) => (
          <TableRow key={call.id}>
            <TableCell>{call.startedAt ? <LocalDateTime iso={call.startedAt.toISOString()} /> : "-"}</TableCell>
            <TableCell>{call.callerNumber ?? "Withheld"}</TableCell>
            <TableCell>{formatCallDuration(call.startedAt, call.endedAt)}</TableCell>
            <TableCell>{describeEndedReason(call.endedReason)}</TableCell>
            <TableCell>
              {call.analysisStuck ? (
                // The run was cut off: the call page has the "Analyze now" button.
                <Link href={`/calls/${call.id}`} className="text-sm font-medium text-destructive underline">
                  Stuck: analyze now
                </Link>
              ) : (
                <DecisionBadge analysisStatus={call.analysisStatus} aiOutcome={call.aiOutcome} escalated={call.escalatedAt !== null} />
              )}
            </TableCell>
            <TableCell className="text-right">
              <Link href={`/calls/${call.id}`} className="text-sm hover:underline">
                Transcript
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CallListEmpty({ page, query }: { page: number; query: CallListQuery }) {
  if (page > 1) {
    return (
      <EmptyBox>
        Nothing on this page.{" "}
        <Link href={buildListUrl("/calls", { outcome: query.outcome, q: query.search })} className="underline">
          Go to the first page
        </Link>
      </EmptyBox>
    );
  }
  if (query.search) {
    return (
      <EmptyBox>
        No calls {query.outcome === "all" ? "" : "here "}from a number matching &ldquo;{query.search}&rdquo;.{" "}
        <Link href={buildListUrl("/calls", { outcome: query.outcome })} className="underline">
          Clear search
        </Link>
      </EmptyBox>
    );
  }
  return <EmptyBox>{EMPTY_FILTER_TEXT[query.outcome]}</EmptyBox>;
}

function EmptyBox({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border p-6 text-center text-muted-foreground">{children}</p>;
}
