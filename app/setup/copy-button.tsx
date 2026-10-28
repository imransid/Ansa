"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// Copies the text to the clipboard and says "Copied" for a moment. If the
// browser refuses (clipboard blocked), the text stays selectable on the page.
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} aria-label={label}>
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </Button>
  );
}
