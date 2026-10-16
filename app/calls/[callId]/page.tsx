import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { formatCallDuration } from "@/lib/format-duration";
import { LocalDateTime } from "@/components/local-date-time";
import { requireSessionContext } from "@/lib/session";
import { getCallForSession, type CallDetail } from "@/services/calls";
import { getDashboardSummary } from "@/services/dashboard";
import { CallDecision } from "./call-decision";

export const metadata: Metadata = { title: "Call - ansa" };

export default function CallPage({ params }: PageProps<"/calls/[callId]">) {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      {/* Cache Components rule: the session and the URL's call id are only
          known at request time, so both are read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <CallContent params={params} />
      </Suspense>
    </main>
  );
}

async function CallContent({ params }: Pick<PageProps<"/calls/[callId]">, "params">) {
  const { callId } = await params;
  const session = await requireSessionContext();
  const call = await getCallForSession(session, callId);
  // Unknown id, bad id, or another company's call: all look the same.
  if (!call) {
    notFound();
  }
  const summary = await getDashboardSummary(session);

  return (
    <>
      <AppHeader summary={summary} />
      <Link href="/calls" className="text-sm hover:underline">
        &larr; All calls
      </Link>
      <h1 className="text-xl font-semibold">Call from {call.callerNumber ?? "a withheld number"}</h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Started</dt>
        <dd>{call.startedAt ? <LocalDateTime iso={call.startedAt.toISOString()} /> : "-"}</dd>
        <dt className="text-muted-foreground">Duration</dt>
        <dd>{formatCallDuration(call.startedAt, call.endedAt)}</dd>
        <dt className="text-muted-foreground">Ended because</dt>
        <dd>{call.endedReason ?? "-"}</dd>
      </dl>
      <CallDecision call={call} />
      <Transcript call={call} />
    </>
  );
}

function Transcript({ call }: { call: CallDetail }) {
  if (call.transcriptUnreadable) {
    return (
      <p role="alert" className="text-sm text-destructive">
        This transcript could not be decrypted. Check DATA_ENCRYPTION_KEY.
      </p>
    );
  }
  if (!call.transcript) {
    return <p className="text-sm text-muted-foreground">No transcript for this call.</p>;
  }
  return (
    <section className="grid gap-2">
      <h2 className="text-lg font-semibold">Transcript</h2>
      <pre className="whitespace-pre-wrap rounded-lg border p-4 font-sans text-sm">{call.transcript}</pre>
    </section>
  );
}
