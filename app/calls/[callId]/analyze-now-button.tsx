"use client";

import { useActionState } from "react";
import { analyzeCallAction } from "@/app/actions/calls";
import { Button } from "@/components/ui/button";

// For a call that was never analyzed, or whose analysis seems to have died.
export function AnalyzeNowButton({ callId }: { callId: string }) {
  const [errors, analyzeAction, isAnalyzing] = useActionState(analyzeCallAction, undefined);

  return (
    <form action={analyzeAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="callId" value={callId} />
      <Button type="submit" variant="outline" size="sm" disabled={isAnalyzing}>
        {isAnalyzing ? "Analyzing..." : "Analyze now"}
      </Button>
      <span className="text-sm text-muted-foreground">
        The AI reads the call again and decides whether it needs a ticket. This can take a minute.
      </span>
      {errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.message}
        </p>
      )}
    </form>
  );
}
