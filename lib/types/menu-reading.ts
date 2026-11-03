import type { ProposedMenuItem } from "@/lib/menu-reading/answer";

// "Read my menu" (step 46): a photo of the menu, a PDF or Word file, or
// pasted text, read into a list of dishes for the owner to check. NOTHING is
// saved by reading: the list goes back to the page, and only "Looks right"
// adds the dishes, checked again. textCut: a Word file held more text than
// ansa reads at once (20,000 characters), so only its first part was read.

export type MenuReadingOutcome =
  | { ok: true; items: ProposedMenuItem[]; dropped: number; standIn: boolean; textCut: boolean }
  | { ok: false; message: string };
