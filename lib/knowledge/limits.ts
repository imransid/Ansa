// The limits of knowledge articles (step 34). Its own small file so the forms
// in the browser use the same numbers as the server's Zod schemas
// (lib/validation/knowledge.ts) and the database's CHECKs.

export const KNOWLEDGE_TITLE_MAX_LENGTH = 200;
// A line break counts once, as in the box.
export const KNOWLEDGE_BODY_MAX_LENGTH = 20_000;
// What the AI and the search read: pieces of at most this many characters,
// whole paragraphs where they fit (lib/knowledge/chunking.ts).
export const KNOWLEDGE_CHUNK_MAX_LENGTH = 1_500;
// A web page's address (lib/safe-fetch.ts fetches it).
export const KNOWLEDGE_SOURCE_URL_MAX_LENGTH = 2_000;
// The customer question typed into "Test what the AI finds", and what the
// voice assistant may search for during a call (step 35).
export const KNOWLEDGE_QUESTION_MAX_LENGTH = 500;
// The most of one call's knowledge lookups its page lists (step 35).
export const MAX_CALL_LOOKUPS_SHOWN = 50;

// What one company may keep. Signup is open and payments enforce nothing yet,
// so without a cap one account could fill the database with imported drafts
// (20,000 characters each). 1,000 articles is about 20 MB of text.
export const MAX_KNOWLEDGE_ARTICLES_PER_COMPANY = 1_000;
// The most text one import (a document or a web page) turns into articles.
// More is cut, and the page says so.
export const MAX_IMPORTED_CHARACTERS = 200_000;

// What every form that writes knowledge says (step 34): knowledge is stored
// as plain text so it can be searched, and the AI may quote it to anyone.
export const NO_CUSTOMER_DATA_NOTICE =
  "Write for every customer: no customer names, emails, phone numbers or account details. Articles are stored as plain text so they can be searched, and approved ones may be quoted to any customer.";
// The same, where knowledge is imported (a Setup document, a web page).
export const NO_CUSTOMER_DATA_IMPORT_NOTICE =
  "Only import text written for every customer: no customer names, emails, phone numbers or account details. Articles are stored as plain text so they can be searched, and approved ones may be quoted to any customer.";
