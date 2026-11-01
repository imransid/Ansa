import { toPlainSingleLine } from "@/lib/plain-text";
import type { CompanyKind } from "@/lib/restaurant-setup";

// The first message ansa sends in a conversation says it comes from an AI
// (step 49: the EU AI Act's Article 50 from 2 August 2026, and Meta's rules
// for Messenger). ansa writes it, never the AI: a reply and a holding reply
// get it the same way. Pure.

// A business's: "I'm the AI assistant for Luigi's Trattoria." A person's
// (step 50): "I'm Rafa's AI assistant." Never the AI's own words.
export function aiLabel(name: string, kind: CompanyKind = "business"): string {
  const clean = toPlainSingleLine(name).trim();
  if (kind === "personal") {
    return clean ? `I'm ${clean}'s AI assistant.` : "I'm an AI assistant.";
  }
  return `I'm the AI assistant for ${clean || "this business"}.`;
}

// The text as sent: the label on its own line first, when nothing automated
// was sent in this conversation before.
export function withAiLabel(text: string, name: string, isFirstAutomatedMessage: boolean, kind: CompanyKind = "business"): string {
  return isFirstAutomatedMessage ? `${aiLabel(name, kind)}\n${text}` : text;
}
