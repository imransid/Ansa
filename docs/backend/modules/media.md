# media: the media library (core/internal/media)

**What:** a company's images and videos (the old
`services/media-library.ts`, `media-deletion.ts`, `media-files.ts`,
`draft-media.ts`, `db/media-*.ts`, `db/content-draft-media.ts`,
`lib/media/`), in private storage ([files](files.md)) under
`media/<companyId>/<assetId>.<ext>` (a CHECK refuses any other key).
Everyone in the company uses it. Making images: [mediagen](mediagen.md).

**Rules:**
- Uploads (`files.go`, `upload.go`): the name's type AND the file's own
  first bytes must agree (PNG, JPEG, WebP, GIF, MP4; never SVG; a HEIF or
  AVIF photo isn't an MP4); 4 MB; 30 uploads per 10 minutes per person
  ("media-uploads"); 300 files and 500 MB per company, uploads and generated
  files together (two at once can pass by one). The type stored comes from
  the bytes; the name shown is one plain line of at most 200 characters; a
  file whose row isn't saved is removed.
- Sizes (`dimensions.go`): read from the header, as the image is shown (a
  JPEG whose Exif orientation turns it a quarter swaps them, either byte
  order); a video, or a header cut short, has none.
- Alt text (`changes.go`): one plain line of at most 1,000. It is
  published with the file, so a change is the next version of EVERY draft
  using it, without its approval (archived ones stay archived); refused
  while a draft that is scheduled, published or failed uses it (naming it).
- Deleting: refused while an approved, scheduled, published or failed draft
  uses it (naming it); otherwise its drafts lose it as their next version,
  the job that made it keeps its history (`asset_deleted_at`), the row goes
  and then the file (a failed file delete is only logged).
- Attaching (`drafts.go`, `SetDraftMedia`): an image to a post with an
  image, a video to a video, nothing to a text post; at the version the
  page showed; the next version without any approval; the AI's text stays
  the AI's (generated_version comes along); an idea with an image is a
  draft, and an idea again once it is taken off.
- Lock orders: delete and alt text: the person, the asset, every draft
  using it; attach: the person, the asset FOR KEY SHARE, the draft.

**API:**
- `GET /api/v1/media?page=n` → `{assets: [{id, kind, source, contentType, sizeBytes, width, height, originalName, altText, provider, createdAt, createdByName, prompt, usedBy: [{assetId, draftId, topic, status}]}], totals: {count, totalBytes}, jobs (see [mediagen](mediagen.md)), generation: {available, isStandIn, makesVideo}, page, pageSize}`.
- `POST /api/v1/media` `{fileName, data: base64, altText}` (up to 6 MB of JSON) → `{assetId}`; 400 with the page's words, 409 full, 503 storage down.
- `GET /api/v1/media/{id}/file` → `{url}` (a 5-minute signed link) or, in development, `{contentType, data: base64}`: the screens serve it inline with the stored type, nosniff and a sandbox. 1,000 per 10 minutes per person ("media-views"): 429, never 404.
- `POST /api/v1/media/{id}/alt-text` `{altText}` → `{outcome: changed | unchanged}`; 409 in use.
- `POST /api/v1/media/{id}/delete` `{}` → `{outcome: "deleted"}`; 409 in use.
- `POST /api/v1/cofounder/drafts/{id}/media` `{version, assetId}` (`""` takes it off) → `{outcome}` (the content-draft-changes limit).
- Alt text, delete, Cancel and Start now: 120 per 10 minutes per person ("media-changes").
- A draft's page holds `media: {kind, attached, attachedLibraryPage, choices (the newest 24 of its kind), openJob: {id, status, createdAt, isStuck, forThisVersion} | null, lastFailure: {code, text} | null, generation}`.

**Tests:** `media/files_test.go` (types by their bytes, the name and the
bytes agree, 4 MB, sizes and Exif orientation, the shown name),
`media/library_test.go` (the key and what is stored, another company
finds nothing, 500 MB, attaching, alt text, deleting),
`api/media_test.go`.
