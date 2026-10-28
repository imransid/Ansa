// The limits of the Co-Founder's media library (step 39). Its own small file
// so the forms in the browser, the server's Zod schemas
// (lib/validation/media.ts), the services and the database's CHECKs
// (db/schema/media.ts) use the same numbers.

// Under Vercel's 4.5 MB request limit (next.config.ts allows 5 MB actions),
// as documents are (lib/document-files.ts). A bigger file is refused in the
// browser before it is sent: the platform would cut the request off before
// our server could answer. Real videos are usually bigger: they need uploads
// straight to storage (CLAUDE.md, known gaps).
export const MAX_MEDIA_UPLOAD_BYTES = 4 * 1024 * 1024;

// What one company may keep in its library in all, uploads and generated
// files together. Signup is open and payments enforce nothing yet, so
// without a cap one account could fill the platform's bucket, at ansa's
// expense (as for documents, services/documents.ts).
export const MAX_MEDIA_ASSETS_PER_COMPANY = 300;
export const MAX_MEDIA_STORAGE_BYTES_PER_COMPANY = 500 * 1024 * 1024;

// The largest file an image or video service may send back. A 4K image or a
// short video fits; anything bigger is refused, never stored.
export const MAX_GENERATED_MEDIA_BYTES = 100 * 1024 * 1024;

// What a picture shows, for people who can't see it (one line).
export const MEDIA_ALT_TEXT_MAX_LENGTH = 1_000;
// What the person asks the image service for. The same as a draft's image
// description (DRAFT_IMAGE_PROMPT_MAX_LENGTH), so a draft's always fits.
export const GENERATION_PROMPT_MAX_LENGTH = 2_000;
// An uploaded file's name as shown in the library.
export const MEDIA_ORIGINAL_NAME_MAX_LENGTH = 200;

// A run that claimed a job and stopped (a crash, a deploy, a time limit)
// leaves it "being made"; this long after the run started, another run may
// claim it again, at most this many times in all. Longer than any run can
// take (the pages' and the job's 300 seconds), so a slow run is never raced.
export const STALE_GENERATION_MINUTES = 15;
export const MAX_GENERATION_ATTEMPTS = 3;
// A request still waiting this long after it was made lost the run that
// should have started it right away (after the page's answer): the
// scheduled job takes it, and the pages offer "Start now".
export const QUEUED_GENERATION_STUCK_MINUTES = 2;

// The media page lists this many of the newest generation requests, and a
// draft's page offers this many of the newest images or videos to attach.
export const GENERATION_JOBS_SHOWN = 20;
export const MEDIA_CHOICES_SHOWN = 24;
