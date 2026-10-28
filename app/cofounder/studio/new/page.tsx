import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { canManageBusinessProfile } from "@/lib/cofounder/permissions";
import { requireSessionContext } from "@/lib/session";
import { getNewDraftOptionsForSession } from "@/services/content-drafts";
import { MissingFacts } from "../../missing-facts";
import { NewDraftForm } from "./new-draft-form";

export const metadata: Metadata = { title: "New draft - Co-Founder - ansa" };

// "Write it with the AI" asks Claude inside this page's server action (up
// to about 4 minutes): the host's default time limit can be as short as 10
// seconds.
export const maxDuration = 300;

export default function NewDraftPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      {/* Cache Components rule: the session is only known at request time,
          so it is read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <NewDraftContent />
      </Suspense>
    </main>
  );
}

// A new draft (step 38), by anyone in the company: written by the AI, or
// started blank. The AI needs the key facts confirmed first; a blank draft
// doesn't.
async function NewDraftContent() {
  const session = await requireSessionContext("/cofounder/studio/new");
  const options = await getNewDraftOptionsForSession(session);
  const aiCanWrite = options.missingForAi.length === 0;

  return (
    <>
      <Link href="/cofounder/studio" className="text-sm hover:underline">
        &larr; Content studio
      </Link>
      <section className="grid gap-2">
        <h1 className="text-xl font-semibold">New draft</h1>
        <p className="text-sm text-muted-foreground">
          One post for one platform. The AI writes it from the facts confirmed on the{" "}
          <Link href="/cofounder/profile" className="underline">
            Profile page
          </Link>{" "}
          and your approved knowledge articles ticked for marketing, and lists every claim it makes about your business.
          It is told never to invent numbers, customers or results, but it can still get things wrong: read every draft
          before an owner approves it.
        </p>
      </section>
      {!aiCanWrite && (
        <MissingFacts missing={options.missingForAi} isOwner={canManageBusinessProfile(session.role)} writes="a draft">
          <p className="text-muted-foreground">Meanwhile anyone can start a blank draft and write it.</p>
        </MissingFacts>
      )}
      <NewDraftForm planChoices={options.planChoices} aiCanWrite={aiCanWrite} />
    </>
  );
}
