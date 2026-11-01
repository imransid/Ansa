import type { FormErrors } from "@/lib/form-result";

// What "Review performance" on the Analytics page (step 42, owners) gives
// back to its form: done (the page shows the new review), or why not.
export type PerformanceReviewResult = { ok: true } | { ok: false; errors: FormErrors };
