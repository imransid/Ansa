import type { FormErrors } from "@/lib/form-result";

// What an import into knowledge ("Add to knowledge" on a Setup document,
// "Import a web page") gives back to its button or form: how many draft
// articles it made, and whether the text was cut to fit.
export type ImportResult = { ok: true; createdCount: number; wasCut: boolean } | { ok: false; errors: FormErrors };
