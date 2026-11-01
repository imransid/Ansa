import type { ProposedMenuItem } from "@/lib/menu-reading/answer";

// "Read my menu" (step 46): a photo of the menu, a PDF or Word file, or
// pasted text, read into a list of dishes for the owner to check. NOTHING is
// saved by reading: the list goes back to the page, and only "Looks right"
// adds the dishes, checked again.

export type MenuReadingOutcome =
  | { ok: true; items: ProposedMenuItem[]; dropped: number; standIn: boolean }
  | { ok: false; message: string };
