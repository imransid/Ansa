# files (core/internal/files)

**What:** core's private file storage (the old `lib/file-storage.ts`,
`adapters/r2.ts`, `adapters/dev-file-storage.ts`): call recordings, uploaded
documents, the media library. Core code calls `Store` only, never R2 or the
folder directly.

**Where:** development: `<DevFolder>/.dev-files` (git-ignored, every key
kept inside it). Production: Cloudflare R2 (`USE_R2_STORAGE=true` with
R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET; production
refuses to start without it). The bucket must stay PRIVATE.

**Keys:** made by core from ids only (`<kind>/<companyId>/<id>.<ext>`):
lower-case letters, digits, `/ . _ -`, starting with a letter or digit, no
`..`. Anything else is `ErrUnsafeKey`, never stored or read.

**Calls:** `Put` (with the type core decided), `Read` (on the server only: a
document's text, a post's image; at most 100 MB), `Delete` (a missing file
is fine), `Reach` (how a browser gets it: a link that works for N seconds,
answered with the stored type whatever the object says and saved under a
name when given; in development the bytes, served by core's route after its
login check).

**R2 requests (`sigv4.go`):** AWS Signature Version 4 (the S3 API), written
with the standard library only instead of the AWS SDK: path-style
`https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`, region "auto",
the body's SHA-256 signed, 60 s per request; presigned links sign the host
only (UNSIGNED-PAYLOAD). Tested against AWS's own documented examples (the
GET Object header signature and the presigned URL signature).

**Tests:** `sigv4_test.go` (AWS's two documented signatures);
`files_test.go` (the folder keeps every key inside, unsafe keys refused;
R2 gets signed PUT and GET requests, and a link with its expiry and type).
