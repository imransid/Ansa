import "server-only";
import { callCore } from "@/lib/core-api";
import { toMediaAsset, type CoreAsset } from "@/lib/core-views/media";
import { draftPath } from "@/lib/core-views/studio";
import type { ContentDraftPage } from "@/services/content-drafts";
import type { DraftMediaPanel } from "@/services/draft-media";

// A content draft's page through the new backend (core's GET
// /api/v1/cofounder/drafts/{id}): the draft with its review against the
// facts now, what the AI wrote it from, and its image or video, in the
// shape the page already reads.

type Approval = NonNullable<ContentDraftPage["approval"]>;
type Rejection = NonNullable<ContentDraftPage["rejection"]>;
type OpenJob = NonNullable<DraftMediaPanel["openJob"]>;

// Dates come as ISO text; a text post's media kind as "".
type CoreMediaPanel = {
  kind: "image" | "video" | "";
  attached: CoreAsset | null;
  attachedLibraryPage: number | null;
  choices: CoreAsset[];
  openJob: (Omit<OpenJob, "createdAt"> & { createdAt: string }) | null;
  lastFailure: { code: string } | null;
  generation: DraftMediaPanel["generation"];
};

type CoreDraftPage = Omit<ContentDraftPage, "plannedFor" | "createdAt" | "updatedAt" | "approval" | "rejection" | "media"> & {
  plannedFor: string | null;
  createdAt: string;
  updatedAt: string;
  approval: (Omit<Approval, "at"> & { at: string }) | null;
  rejection: (Omit<Rejection, "at"> & { at: string }) | null;
  media: CoreMediaPanel;
};

// One draft of the company and whether this person approves and rejects
// (an owner); null for a malformed id, an unknown draft or another company's.
export async function getContentDraftPageFromCore(draftId: string): Promise<{ draft: ContentDraftPage; canReview: boolean } | null> {
  const path = draftPath(draftId);
  if (!path) {
    return null;
  }
  const answer = await callCore<{ draft: CoreDraftPage; canReview: boolean }>("GET", path);
  if (!answer.ok && answer.status === 404) {
    return null;
  }
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return { draft: toDraftPage(answer.data.draft), canReview: answer.data.canReview };
}

function toDraftPage(draft: CoreDraftPage): ContentDraftPage {
  const { plannedFor, createdAt, updatedAt, approval, rejection, media, ...rest } = draft;
  return {
    ...rest,
    plannedFor: plannedFor ? new Date(plannedFor) : null,
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
    approval: approval ? { ...approval, at: new Date(approval.at) } : null,
    rejection: rejection ? { ...rejection, at: new Date(rejection.at) } : null,
    media: toMediaPanel(media),
  };
}

// Built field by field: the panel goes to the browser, so nothing core
// adds for its own pages (a failure's words, whether videos are made)
// rides along.
function toMediaPanel(panel: CoreMediaPanel): DraftMediaPanel {
  return {
    kind: panel.kind === "" ? null : panel.kind,
    attached: panel.attached ? toMediaAsset(panel.attached) : null,
    attachedLibraryPage: panel.attachedLibraryPage,
    choices: panel.choices.map(toMediaAsset),
    openJob: panel.openJob ? { ...panel.openJob, createdAt: new Date(panel.openJob.createdAt) } : null,
    lastFailure: panel.lastFailure ? { code: panel.lastFailure.code } : null,
    generation: { available: panel.generation.available, isStandIn: panel.generation.isStandIn },
  };
}
