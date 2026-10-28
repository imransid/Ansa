import { cache, Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canReviewContentDrafts } from "@/lib/cofounder/permissions";
import { getSessionContext, requireSessionContext } from "@/lib/session";
import { getContentDraftPageForSession } from "@/services/content-drafts";
import { getDraftPublishingForSession } from "@/services/draft-publishing";
import { DraftClaims } from "./draft-claims";
import { DraftMadeFrom } from "./draft-made-from";
import { DraftPublishingSection } from "./draft-publishing";
import { DraftSummary } from "./draft-summary";
import { DraftWorkspace } from "./draft-workspace";

// One read per request: the tab title and the page both need the draft.
const readDraft = cache(getContentDraftPageForSession);

// "Regenerate" asks Claude inside this page's server action (up to about 4
// minutes), "Make the image with the AI" has it made right after the
// action's answer (step 39), and a post scheduled for now goes out right
// after it (step 41): the host's default time limit can be as short as 10
// seconds.
export const maxDuration = 300;

// "Our new lunch menu - Studio - ansa". A long topic is cut here.
export async function generateMetadata({ params }: PageProps<"/cofounder/studio/[draftId]">): Promise<Metadata> {
  const { draftId } = await params;
  const session = await getSessionContext();
  // Logged out: the page sends them to /login.
  if (!session) {
    return { title: "Draft - ansa" };
  }
  const draft = await readDraft(session, draftId);
  if (!draft) {
    return { title: "Draft not found - ansa" };
  }
  const topic = draft.topic.length > 60 ? `${draft.topic.slice(0, 60).trimEnd()}...` : draft.topic;
  return { title: `${topic} - Studio - ansa` };
}

export default function ContentDraftPage({ params }: PageProps<"/cofounder/studio/[draftId]">) {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-8 p-6">
      {/* Cache Components rule: the session and the URL's draft id are only
          known at request time, so both are read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <DraftContent params={params} />
      </Suspense>
    </main>
  );
}

// One content draft (step 38): what it is, the editor with its live checks
// and preview, its claims and the owner's decision, publishing it (step
// 41), and what the AI wrote it from. Everyone in the company writes;
// owners approve, reject and schedule.
async function DraftContent({ params }: Pick<PageProps<"/cofounder/studio/[draftId]">, "params">) {
  const { draftId } = await params;
  const session = await requireSessionContext(`/cofounder/studio/${encodeURIComponent(draftId)}`);
  const draft = await readDraft(session, draftId);
  // Unknown id, bad id, or another company's draft: all look the same (../not-found.tsx).
  if (!draft) {
    notFound();
  }
  const publishing = await getDraftPublishingForSession(session, draft);

  return (
    <>
      <div className="grid gap-4">
        <Link href="/cofounder/studio" className="text-sm hover:underline">
          &larr; Content studio
        </Link>
        <DraftSummary draft={draft} />
      </div>
      <DraftWorkspace
        draft={{
          id: draft.id,
          platform: draft.platform,
          format: draft.format,
          status: draft.status,
          version: draft.version,
          topic: draft.topic,
          pillar: draft.pillar,
          campaign: draft.campaign,
          fields: draft.fields,
          editedByHand: draft.editedByHand,
        }}
        // Hiding Approve and Reject is only for a tidy page: the services and /db refuse members.
        isOwner={canReviewContentDrafts(session.role)}
        wordsToAvoid={draft.review.wordsToAvoid}
        businessName={draft.businessName}
        planChoices={draft.planChoices}
        acknowledgmentNeeded={draft.review.acknowledgmentNeeded}
        blockingCount={draft.review.blockingIssues.length}
        claims={<DraftClaims review={draft.review} generatedVersion={draft.generatedVersion} />}
        media={draft.media}
        hasApproval={draft.approval !== null}
        approvalByFormerOwner={draft.approval !== null && !draft.approval.byActiveOwner}
        publishing={<DraftPublishingSection draft={draft} publishing={publishing} />}
      />
      <DraftMadeFrom madeFrom={draft.madeFrom} />
    </>
  );
}
