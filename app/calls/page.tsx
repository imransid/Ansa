import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCallDuration } from "@/lib/format-duration";
import { formatUtcDateTime } from "@/lib/format-date";
import { requireSessionContext } from "@/lib/session";
import { listCallsForSession, type CallListItem } from "@/services/calls";
import { getDashboardSummary } from "@/services/dashboard";
import { DecisionBadge } from "./decision-badge";

export const metadata: Metadata = { title: "Calls - ansa" };

export default function CallsPage() {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6">
      {/* Cache Components rule: anything that reads the session must sit
          inside <Suspense>, because it can only run at request time. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <CallsContent />
      </Suspense>
    </main>
  );
}

async function CallsContent() {
  const session = await requireSessionContext();
  const [summary, calls] = await Promise.all([
    getDashboardSummary(session),
    listCallsForSession(session),
  ]);

  return (
    <>
      <AppHeader summary={summary} />
      <section className="grid gap-3">
        <h1 className="text-xl font-semibold">Calls</h1>
        <CallsTable calls={calls} />
      </section>
    </>
  );
}

function CallsTable({ calls }: { calls: CallListItem[] }) {
  if (calls.length === 0) {
    return (
      <p className="rounded-lg border p-6 text-center text-muted-foreground">
        No calls yet. Finished calls appear here once Vapi sends them.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Started (UTC)</TableHead>
          <TableHead>Caller</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Ended because</TableHead>
          <TableHead>AI decision</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {calls.map((call) => (
          <TableRow key={call.id}>
            <TableCell>{call.startedAt ? formatUtcDateTime(call.startedAt) : "-"}</TableCell>
            <TableCell>{call.callerNumber ?? "Withheld"}</TableCell>
            <TableCell>{formatCallDuration(call.startedAt, call.endedAt)}</TableCell>
            <TableCell>{call.endedReason ?? "-"}</TableCell>
            <TableCell>
              <DecisionBadge analysisStatus={call.analysisStatus} aiOutcome={call.aiOutcome} />
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
