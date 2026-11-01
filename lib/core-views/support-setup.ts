import "server-only";
import { callCore, type CoreAnswer } from "@/lib/core-api";
import { toFormErrors } from "@/lib/core-views/auth";
import { EMPTY_FILE_MESSAGE, MAX_DOCUMENT_BYTES, TOO_BIG_MESSAGE } from "@/lib/document-files";
import type { FormResult } from "@/lib/form-result";
import type { CompanyDocument, DocumentDownload } from "@/lib/types/documents";
import type { SetupOverview } from "@/lib/types/setup";
import { documentIdSchema } from "@/lib/validation/setup";

// The Setup page ("Phone, email and documents") and the document download
// through the new backend (core's /api/v1/settings/support and
// /api/v1/documents), in the shapes the page, its actions and the route
// already read.

// A form value as the forms send it: text, or nothing.
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function savedOrErrors(answer: CoreAnswer<unknown>): FormResult {
  return answer.ok ? { ok: true } : { ok: false, errors: toFormErrors(answer) };
}

// A document as the page lists it (core never sends where it is stored).
export type ListedDocument = Omit<CompanyDocument, "storageKey">;

type LastEmail = NonNullable<SetupOverview["lastInboundEmail"]>;

type CoreSupportPage = {
  overview: {
    replyToEmail: string | null;
    supportAddresses: string[];
    activeCategories: number;
    members: number;
    peopleWithoutCategories: number;
    documents: number;
  };
  forwardingAddress: string;
  // What became of the newest email that reached the forwarding address.
  lastEmail: (Omit<LastEmail, "receivedAt"> & { receivedAt: string }) | null;
  phoneLines: { id: string; lastCallAt: string | null }[];
  documents: (Omit<ListedDocument, "createdAt"> & { createdAt: string })[];
  canManage: boolean;
};

// Everything the page shows: the addresses, the last email and what became
// of it, the phone lines, the checklist's counts, the documents, and whether
// this person is an owner.
export async function getSupportSetupFromCore(): Promise<{ setup: SetupOverview; documents: ListedDocument[]; isOwner: boolean }> {
  const answer = await callCore<CoreSupportPage>("GET", "/api/v1/settings/support");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const { overview, forwardingAddress, lastEmail, phoneLines, documents, canManage } = answer.data;
  return {
    setup: {
      replyToEmail: overview.replyToEmail,
      lastInboundEmail: lastEmail ? { ...lastEmail, receivedAt: new Date(lastEmail.receivedAt) } : null,
      inboundAddresses: overview.supportAddresses,
      phoneLines: phoneLines.map((line) => ({ vapiPhoneNumberId: line.id, lastCallAt: line.lastCallAt ? new Date(line.lastCallAt) : null })),
      activeCategoryCount: overview.activeCategories,
      memberCount: overview.members,
      peopleWithoutCategories: overview.peopleWithoutCategories,
      documentCount: overview.documents,
      forwardingAddress,
    },
    documents: documents.map((document) => ({ ...document, createdAt: new Date(document.createdAt) })),
    isOwner: canManage,
  };
}

// The company's name (in the sender of every customer email).
export async function getCompanyNameFromCore(): Promise<string> {
  const answer = await callCore<{ profile: { companyName: string } }>("GET", "/api/v1/setup");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return answer.data.profile.companyName;
}

// Renames the company (owners): also the sender name of every customer email.
export async function setCompanyNameThroughCore(companyName: unknown): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", "/api/v1/settings/support/company-name", { companyName: text(companyName) }));
}

// "" clears it: replies then go to the forwarding address.
export async function setReplyToEmailThroughCore(replyToEmail: unknown): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", "/api/v1/settings/support/reply-to", { replyToEmail: text(replyToEmail) }));
}

export async function addSupportAddressThroughCore(address: unknown): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", "/api/v1/settings/support/addresses", { address: text(address) }));
}

export async function removeSupportAddressThroughCore(address: unknown): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", "/api/v1/settings/support/addresses/remove", { address: text(address) }));
}

// Stores one uploaded document (owners). The file goes as base64.
export async function uploadDocumentThroughCore(file: unknown): Promise<FormResult> {
  if (!(file instanceof File)) {
    return { ok: false, errors: { message: EMPTY_FILE_MESSAGE } };
  }
  // WHY here: a bigger file, as base64, passes core's body limit and would
  // get a bare refusal instead of these words (the form checks it first too).
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { ok: false, errors: { message: TOO_BIG_MESSAGE } };
  }
  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  return savedOrErrors(await callCore("POST", "/api/v1/documents", { fileName: file.name, data }));
}

export async function deleteDocumentThroughCore(documentId: unknown): Promise<FormResult> {
  return savedOrErrors(await callCore("POST", `/api/v1/documents/${encodeURIComponent(text(documentId))}/delete`));
}

// One document to download: a short-lived signed link, or (development)
// its bytes. "rate-limited" after too many downloads, null when there is
// no such document in the company.
export async function getDocumentFromCore(documentId: string): Promise<DocumentDownload> {
  if (!documentIdSchema.safeParse({ documentId }).success) {
    return null;
  }
  const answer = await callCore<{ url: string } | { fileName: string; contentType: string; data: string }>(
    "GET",
    `/api/v1/documents/${encodeURIComponent(documentId)}/download`,
  );
  if (!answer.ok) {
    if (answer.status === 429) {
      return "rate-limited";
    }
    if (answer.status === 404) {
      return null;
    }
    throw new Error(`Core answered ${answer.status}`);
  }
  if ("url" in answer.data) {
    // The signed link names the file itself ("save as"), so no name is needed here.
    return { access: { kind: "signed-url", url: answer.data.url }, fileName: "" };
  }
  const { fileName, contentType, data } = answer.data;
  return { access: { kind: "bytes", bytes: Buffer.from(data, "base64"), contentType }, fileName };
}
