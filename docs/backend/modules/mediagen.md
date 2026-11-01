# mediagen: making images and videos (core/internal/mediagen)

**What:** the one door to image and video services (the old
`lib/media-generation.ts`, `services/media-generation-*.ts`,
`db/media-generation-*.ts`, `adapters/dev-media-generator.ts`). Each
service is one `Provider` (start → the file or a job id; poll → running,
done or failed with a code). No real service is chosen yet: only the
development stand-in (`standin.go`: a real 1024 x 1024 PNG in one colour
from the prompt's hash, free; no video: "no_video_provider").

**Mode (`mode.go`, MEDIA_PROVIDER):** empty in development = the stand-in;
production refuses the stand-in, even when named, so generation is "off"
there (nothing is saved; the pages say it isn't set up). A job runs only on
the service it was asked of ("provider_unavailable" otherwise).

**Rules:**
- A request (`requests.go`, `jobs.go`): "Generate an image" (a kind and a
  prompt of 1-2,000 characters, a line break counting once), or "Make the
  image with the AI" on a post with an image (its SAVED description, at the
  version the page showed). Refused before anything is saved: off, the
  company's 30 a day ("media-generations"), a library full counting the
  requests still open as files, a stale or archived draft, no description,
  one already being made for the draft. Saved queued (the person, the
  draft, its requests locked in that order; a stuck one of the same draft
  is ended "superseded"), then run right after the answer (a goroutine
  with its own time limit).
- A run (`runs.go`, `claims.go`, `ask.go`) CLAIMS the job in ONE UPDATE
  (queued, or running 15+ minutes with fewer than 3 tries; a third cut-off
  is ended "interrupted"); every later write names the attempt it claimed.
  The service's job id is kept before the first poll (a later run polls,
  never asks again). A result is fetched at once from the service's own
  hosts only (https, every redirect checked, 30 s, [download](calls.md)),
  kept only when its BYTES are an accepted file of the kind asked for (100
  MB at most: "output_too_large"). Anything else ends the job failed with a
  code (`ErrorWords`), never an asset.
- Saving (`save.go`): the company row lock FIRST, the requester, the draft,
  the job; the cap counted again ("library_full": no asset, the file
  removed); the asset, the job succeeded and, when asked from a draft still
  editable and still at the version it was asked at, the draft with it
  attached as its next version, without its approval. Otherwise the image
  only goes to the library.
- Cancel: queued only. Start now: a stuck request (queued 2+ minutes, or
  running 15+) is CLAIMED before the answer, then run after it.
- The periodic task "stuck media requests" (every minute,
  `cmd/core/wiring.go`) finds stuck requests of every company (ids only,
  listed in CROSS_COMPANY.md) and runs each through its company's path,
  starting one only while its slowest run fits in the round's 300 s.
- Logs: codes and class names only; never the prompt, an address or a key.

**API:**
- `POST /api/v1/media/generations` `{kind, prompt}` → `{jobId}`; 409 with why.
- `POST /api/v1/cofounder/drafts/{id}/image` `{version}` → `{jobId}`; 409 with why.
- `POST /api/v1/media/generations/{id}/cancel` `{}` → `{outcome: "canceled"}`; 409 not waiting.
- `POST /api/v1/media/generations/{id}/start` `{}` → `{outcome: "started" | "interrupted"}`; 409 not stuck.
- The media page's `jobs`: `[{id, kind, prompt, provider, status, attempts, lastError, lastErrorText, costCents, assetId, assetDeletedAt, libraryPage, draftId, draftTopic, draftMediaAssetId, requestedByName, createdAt, finishedAt, isStuck}]` (the newest 20).

**Tests:** `standin_test.go` (the PNG, the colour, no video; production
refuses the stand-in), `requests_test.go` (made and linked; off in
production; the daily limit and the cap with open requests; library_full;
attached only at its version; superseded), `runs_test.go` (five runs at
once make one asset; polled, never asked again; results checked by their
bytes; interrupted; Cancel; the stuck finder).
