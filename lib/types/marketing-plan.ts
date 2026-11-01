import type { FormErrors } from "@/lib/form-result";

// What "Make a new plan" (step 37) gives back to its form: the new plan's
// version, or why there is none (a plan Claude couldn't write saves nothing).
export type MarketingPlanResult = { ok: true; version: number } | { ok: false; errors: FormErrors };
