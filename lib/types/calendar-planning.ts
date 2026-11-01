import type { FormErrors } from "@/lib/form-result";

// What "Plan the next 2 weeks" on the calendar (step 41, owners) gives back
// to its form: how many ideas were planned, or why none (without a usable
// answer from Claude nothing is saved).
export type CalendarPlanResult = { ok: true; added: number } | { ok: false; errors: FormErrors };
