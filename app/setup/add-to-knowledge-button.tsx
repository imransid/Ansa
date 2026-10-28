"use client";

import { useActionState } from "react";
import { importDocumentToKnowledgeAction } from "@/app/actions/knowledge";
import { KnowledgeImportOutcome } from "@/components/knowledge-import-outcome";
import { Button } from "@/components/ui/button";

// "Add to knowledge" on one document (step 34, owners): its text becomes
// draft articles. Each click makes new drafts, even for a document added
// before (the Documents section says so).
export function AddToKnowledgeButton({ documentId, fileName }: { documentId: string; fileName: string }) {
  const [state, action, isAdding] = useActionState(importDocumentToKnowledgeAction, undefined);
  const result = state?.result;
  return (
    <form action={action} className="grid w-full justify-items-start gap-1 sm:w-auto">
      <input type="hidden" name="documentId" value={documentId} />
      <Button type="submit" variant="outline" size="sm" disabled={isAdding} aria-label={`Add ${fileName} to knowledge`}>
        {isAdding ? "Reading the file..." : "Add to knowledge"}
      </Button>
      {result && !result.ok && (
        <p role="alert" className="max-w-sm text-sm text-destructive">
          {result.errors.message}
        </p>
      )}
      {result?.ok && <KnowledgeImportOutcome createdCount={result.createdCount} wasCut={result.wasCut} />}
    </form>
  );
}
