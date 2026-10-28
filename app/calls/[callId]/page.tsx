import { cache, Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatCallDuration } from "@/lib/format-duration";
import { LocalDateTime } from "@/components/local-date-time";
import { getSessionContext, requireSessionContext } from "@/lib/session";
import { getCallForSession, type CallDetail } from "@/services/calls";
import { listActiveCategoriesForSession } from "@/services/categories";
import { CallDecision } from "./call-decision";
import { KnowledgeLookups } from "./knowledge-lookups";

// "Analyze now" asks Claude inside this page's server action (up to 3 tries
// of 60 s): the host's default time limit can be as short as 10 seconds.
export const maxDuration = 300;

// One read per request: the tab title and the page both need the call.
const readCall = cache(getCallForSession);

// "Call from a number ending 0100 - ansa", so several call tabs can be told
// apart. WHY not the whole number: tab titles end up in browser history (and
// its sync), and phone numbers are customer data; four digits are enough to
// tell tabs apart.
export async function generateMetadata({ params }: PageProps<"/calls/[callId]">): Promise<Metadata> {
  const { callId } = await params;
  const session = await getSessionContext();
  // Logged out: the page sends them to /login.
  if (!session) {
    return { title: "Call - ansa" };
  }
  const call = await readCall(session, callId);
  if (!call) {
    return { title: "Call not found - ansa" };
  }
  const lastDigits = (call.callerNumber ?? "").replace(/\D/g, "").slice(-4);
  return { title: lastDigits ? `Call from a number ending ${lastDigits} - ansa` : "Call from a withheld number - ansa" };
}

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
  const session = await requireSessionContext(`/calls/${encodeURIComponent(callId)}`);
  const call = await readCall(session, callId);
  // Unknown id, bad id, or another company's call: all look the same (./not-found.tsx).
  if (!call) {
    notFound();
  }
  const categories = await listActiveCategoriesForSession(session);

  return (
    <>
      <Link href="/calls" className="text-sm hover:underline">
        &larr; All calls
      </Link>
      <h1 className="text-xl font-semibold wrap-anywhere">Call from {call.callerNumber ?? "a withheld number"}</h1>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Started</dt>
        <dd>{call.startedAt ? <LocalDateTime iso={call.startedAt.toISOString()} /> : "-"}</dd>
        <dt className="text-muted-foreground">Duration</dt>
        <dd>{formatCallDuration(call.startedAt, call.endedAt)}</dd>
        <dt className="text-muted-foreground">Ended because</dt>
        <dd className="wrap-anywhere">{call.endedReason ?? "-"}</dd>
      </dl>
      <CallDecision call={call} categories={categories} />
      <KnowledgeLookups session={session} callId={call.id} />
      <Recording call={call} />
      <Transcript call={call} />
    </>
  );
}

function Transcript({ call }: { call: CallDetail }) {
  if (call.transcriptUnreadable) {
    // What went wrong is in the server log (lib/encryption.ts); the team
    // using the page can't fix it, so it isn't named here.
    return (
      <p role="alert" className="text-sm text-destructive">
        This transcript can&apos;t be shown right now. If this keeps happening, contact ansa support.
      </p>
    );
  }
  if (!call.transcript) {
    return <p className="text-sm text-muted-foreground">No transcript for this call.</p>;
  }
  return (
    <section className="grid gap-2">
      <h2 className="text-lg font-semibold">Transcript</h2>
      {/* wrap-anywhere: a long link or number said in the call wraps instead
          of pushing the page wider than a phone's screen. */}
      <pre className="whitespace-pre-wrap wrap-anywhere rounded-lg border p-4 font-sans text-sm">{call.transcript}</pre>
    </section>
  );
}

// Plays from our own route, which checks the login and company, then hands out
// a 5-minute link to the private bucket. The bucket itself is never public.
function Recording({ call }: { call: CallDetail }) {
  if (call.recordingStatus === "failed") {
    return <p className="text-sm text-muted-foreground">The recording could not be saved.</p>;
  }
  if (call.recordingStatus !== "stored") {
    return null;
  }
  return (
    <section className="grid gap-2">
      <h2 className="text-lg font-semibold">Recording</h2>
      <audio controls preload="none" src={`/api/calls/${call.id}/recording`} className="w-full" />
    </section>
  );
}
