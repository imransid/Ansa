// The longest text each ticket field takes (step 31). Its own small file so
// the forms in the browser use the same limits as the server's Zod schemas
// (lib/validation/ticket-fields.ts) without loading them.

export const TICKET_SUBJECT_MAX_LENGTH = 200;
export const TICKET_DESCRIPTION_MAX_LENGTH = 10_000;
export const CUSTOMER_NAME_MAX_LENGTH = 200;
// Matches the longest caller number the Vapi webhook accepts.
export const CUSTOMER_PHONE_MAX_LENGTH = 40;
// The longest customer address (lib/validation/customer-email.ts).
export const CUSTOMER_EMAIL_MAX_LENGTH = 254;
// What a teammate writes when escalating a call the AI marked solved.
export const ESCALATION_NOTE_MAX_LENGTH = 2_000;
