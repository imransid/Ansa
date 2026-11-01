import type { FormErrors } from "@/lib/form-result";

// What "New draft" gives back to its form: the new draft, or why not.
export type CreatedDraftResult = { ok: true; draftId: string } | { ok: false; errors: FormErrors };
