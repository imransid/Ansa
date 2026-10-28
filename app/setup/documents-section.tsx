"use client";

import { useActionState, useState, type ChangeEvent, type FormEvent } from "react";
import { deleteDocumentAction, uploadDocumentAction } from "@/app/actions/setup";
import { ConfirmButton } from "@/components/confirm-button";
import { LocalDateTime } from "@/components/local-date-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkDocumentFile, DOCUMENT_EXTENSIONS_FOR_PICKER } from "@/lib/document-files";
import { formatFileSize } from "@/lib/format-file-size";
import { NO_CUSTOMER_DATA_IMPORT_NOTICE } from "@/lib/knowledge/limits";
import type { CompanyDocument } from "@/services/documents";
import { AddToKnowledgeButton } from "./add-to-knowledge-button";

type DocumentsSectionProps = {
  documents: CompanyDocument[];
  canManage: boolean;
};

export function DocumentsSection({ documents, canManage }: DocumentsSectionProps) {
  return (
    <div className="grid max-w-3xl gap-3">
      {/* Owners see "Add to knowledge" on every document: one notice for all of them. */}
      {canManage && documents.length > 0 && <p className="rounded-lg border p-3 text-sm">{NO_CUSTOMER_DATA_IMPORT_NOTICE}</p>}
      {documents.length === 0 && <p className="text-sm text-muted-foreground">No documents yet.</p>}
      {documents.length > 0 && (
        <ul className="grid gap-2">
          {documents.map((document) => (
            <DocumentRow key={document.id} document={document} canManage={canManage} />
          ))}
        </ul>
      )}
      {canManage && <UploadForm />}
    </div>
  );
}

function DocumentRow({ document, canManage }: { document: CompanyDocument; canManage: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm">
      {/* A plain link: the route sends the file as a download. */}
      <a href={`/api/documents/${document.id}`} className="min-w-0 font-medium wrap-anywhere hover:underline">
        {document.fileName}
      </a>
      <span className="text-muted-foreground">{formatFileSize(document.sizeBytes)}</span>
      <span className="text-muted-foreground">
        <LocalDateTime iso={document.createdAt.toISOString()} />
      </span>
      {canManage && (
        <div className="ml-auto flex flex-wrap items-start gap-2">
          <AddToKnowledgeButton documentId={document.id} fileName={document.fileName} />
          <ConfirmButton
            action={deleteDocumentAction}
            fields={{ documentId: document.id }}
            label="Delete"
            accessibleLabel={`Delete ${document.fileName}`}
            question={`Delete ${document.fileName}? The file is removed for good. Knowledge articles made from it stay.`}
            confirmLabel="Yes, delete"
            pendingLabel="Deleting..."
          />
        </div>
      )}
    </li>
  );
}

// The file is checked in the browser first (lib/document-files.ts, the same
// rules the server applies): a file over the limit never gets sent, because
// the hosting platform would cut the request off (Vercel at 4.5 MB) before
// our server could answer with a message, and the page would only show an
// error screen.
function UploadForm() {
  const [errors, action, isUploading] = useActionState(uploadDocumentAction, undefined);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  // The server's last answer is about the file that was sent. Once another
  // file is chosen, or while a new upload runs, it no longer applies.
  const [choseAnotherFile, setChoseAnotherFile] = useState(false);
  const serverMessage = choseAnotherFile || isUploading ? undefined : errors?.message;
  const message = fileProblem ?? serverMessage;

  function checkChosenFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    setFileProblem(file ? problemWith(file) : null);
    setChoseAnotherFile(true);
  }

  function stopBadFile(event: FormEvent<HTMLFormElement>) {
    const file = new FormData(event.currentTarget).get("file");
    const problem = file instanceof File ? problemWith(file) : null;
    if (problem) {
      // Nothing is sent: React runs the form's action only when this didn't.
      event.preventDefault();
      setFileProblem(problem);
      return;
    }
    // This file is being sent: the answer to show is the one about it.
    setChoseAnotherFile(false);
  }

  return (
    <form action={action} onSubmit={stopBadFile} className="flex flex-wrap items-end gap-2">
      <div className="grid gap-2">
        <Label htmlFor="file">Add a document (PDF, Word, text, Markdown or CSV, up to 4 MB)</Label>
        <Input
          id="file"
          name="file"
          type="file"
          required
          accept={DOCUMENT_EXTENSIONS_FOR_PICKER}
          onChange={checkChosenFile}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? "file-error" : undefined}
          className="w-80 max-w-full"
        />
      </div>
      <Button type="submit" disabled={isUploading}>
        {isUploading ? "Uploading..." : "Upload"}
      </Button>
      {message && (
        <p id="file-error" role="alert" className="w-full text-sm text-destructive">
          {message}
        </p>
      )}
    </form>
  );
}

function problemWith(file: File): string | null {
  const checked = checkDocumentFile(file);
  return checked.ok ? null : checked.message;
}
