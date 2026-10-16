"use client";

import { useActionState } from "react";
import { deleteDocumentAction, uploadDocumentAction } from "@/app/actions/setup";
import { LocalDateTime } from "@/components/local-date-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CompanyDocument } from "@/services/documents";

type DocumentsSectionProps = {
  documents: CompanyDocument[];
  canManage: boolean;
};

export function DocumentsSection({ documents, canManage }: DocumentsSectionProps) {
  return (
    <div className="grid max-w-3xl gap-3">
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
  const [errors, action, isDeleting] = useActionState(deleteDocumentAction, undefined);
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm">
      {/* A plain link: the route sends the file as a download. */}
      <a href={`/api/documents/${document.id}`} className="font-medium hover:underline">
        {document.fileName}
      </a>
      <span className="text-muted-foreground">{formatSize(document.sizeBytes)}</span>
      <span className="text-muted-foreground">
        <LocalDateTime iso={document.createdAt.toISOString()} />
      </span>
      {canManage && (
        <form action={action} className="ml-auto">
          <input type="hidden" name="documentId" value={document.id} />
          <Button type="submit" variant="ghost" size="sm" disabled={isDeleting} aria-label={`Delete ${document.fileName}`}>
            Delete
          </Button>
        </form>
      )}
      {errors?.message && (
        <p role="alert" className="w-full text-destructive">
          {errors.message}
        </p>
      )}
    </li>
  );
}

function UploadForm() {
  const [errors, action, isUploading] = useActionState(uploadDocumentAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="grid gap-2">
        <Label htmlFor="file">Add a document (PDF, Word, text, Markdown or CSV, up to 4 MB)</Label>
        <Input id="file" name="file" type="file" required accept=".pdf,.docx,.txt,.md,.csv" className="w-80" />
      </div>
      <Button type="submit" disabled={isUploading}>
        {isUploading ? "Uploading..." : "Upload"}
      </Button>
      {errors?.message && (
        <p role="alert" className="w-full text-sm text-destructive">
          {errors.message}
        </p>
      )}
    </form>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
