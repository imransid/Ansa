"use client";

import { useActionState } from "react";
import Link from "next/link";
import { importWebPageAction } from "@/app/actions/knowledge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KNOWLEDGE_SOURCE_URL_MAX_LENGTH, NO_CUSTOMER_DATA_IMPORT_NOTICE } from "@/lib/knowledge/limits";
import { KnowledgeImportOutcome } from "@/components/knowledge-import-outcome";

// The address box. A refused address stays in the box; once the page is
// imported, the box is empty again for the next one.
export function WebImportForm() {
  const [state, action, isImporting] = useActionState(importWebPageAction, undefined);
  const result = state?.result;
  const problem = result && !result.ok ? (result.errors.fieldErrors?.url?.[0] ?? result.errors.message) : undefined;

  return (
    <div className="grid gap-3">
      <p className="rounded-lg border p-3 text-sm">{NO_CUSTOMER_DATA_IMPORT_NOTICE}</p>
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-0 flex-1 gap-2">
          <Label htmlFor="url">Page address</Label>
          <Input
            id="url"
            name="url"
            type="url"
            required
            autoComplete="off"
            maxLength={KNOWLEDGE_SOURCE_URL_MAX_LENGTH}
            placeholder="https://www.example.com/help/returns"
            defaultValue={state?.values?.url}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? "url-error" : undefined}
          />
        </div>
        <Button type="submit" disabled={isImporting}>
          {isImporting ? "Importing..." : "Import"}
        </Button>
        {problem && (
          <p id="url-error" role="alert" className="w-full text-sm text-destructive">
            {problem}
          </p>
        )}
      </form>
      {result?.ok && <KnowledgeImportOutcome createdCount={result.createdCount} wasCut={result.wasCut} />}
      {isImporting && <p className="text-sm text-muted-foreground">Fetching the page (at most 10 seconds)...</p>}
      <p className="text-xs text-muted-foreground">
        Only https pages of up to 2 MB on the public internet. <Link href="/knowledge?status=draft" className="underline">See the drafts</Link>
      </p>
    </div>
  );
}
