// The shortest and longest text each account and team field takes, and how
// many categories a company may keep. Its own small file so the forms in the
// browser stop where the server's Zod schemas would (lib/validation/auth.ts,
// categories.ts) without loading them. Ticket fields have theirs in
// lib/ticket-limits.ts.

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const PERSON_NAME_MAX_LENGTH = 100;
export const COMPANY_NAME_MIN_LENGTH = 2;
export const COMPANY_NAME_MAX_LENGTH = 100;
// A team account's email address (the login).
export const ACCOUNT_EMAIL_MAX_LENGTH = 254;
export const CATEGORY_NAME_MAX_LENGTH = 50;
// Active (not archived) categories per company. The Team page shows one
// checkbox for each, and one person may tick them all.
export const ACTIVE_CATEGORIES_MAX = 100;
