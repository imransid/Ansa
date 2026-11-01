import type { FormErrors } from "@/lib/form-result";

// What creating a ticket by hand (or escalating a call) gives back to its form.
export type CreatedTicketResult = { ok: true; ticketNumber: number } | { ok: false; errors: FormErrors };
