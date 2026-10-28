import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { PaginationLinks } from "@/components/pagination-links";
import { formatFileSize } from "@/lib/format-file-size";
import { MAX_MEDIA_ASSETS_PER_COMPANY, MAX_MEDIA_STORAGE_BYTES_PER_COMPANY } from "@/lib/media/limits";
import { parsePageNumber } from "@/lib/pagination";
import { requireSessionContext } from "@/lib/session";
import { describeGenerationAvailability, listGenerationJobsForSession } from "@/services/media-generation-jobs";
import { getMediaTotalsForSession, listMediaForSession } from "@/services/media-library";
import { GenerateMediaForm } from "./generate-media-form";
import { GenerationJobList } from "./generation-job-list";
import { MediaGrid } from "./media-grid";
import { MediaUploadForm } from "./media-upload-form";
import { RefreshWhilePending } from "@/components/refresh-while-pending";

export const metadata: Metadata = { title: "Media - Co-Founder - ansa" };

// An image is made right after the answer of this page's "Make it" (Next's
// after()), within this page's time limit: the host's default can be as
// short as 10 seconds.
export const maxDuration = 300;

export default function MediaPage({ searchParams }: PageProps<"/cofounder/media">) {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-8 p-6">
      {/* Cache Components rule: the session and the URL's ?page= are only
          known at request time, so both are read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <MediaContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// The company's media library (step 39): upload, ask the AI for an image,
// the requests being made, and every image and video, 50 to a page.
async function MediaContent({ searchParams }: Pick<PageProps<"/cofounder/media">, "searchParams">) {
  const page = parsePageNumber((await searchParams).page);
  const session = await requireSessionContext("/cofounder/media");
  const [assets, totals, jobs] = await Promise.all([listMediaForSession(session, page), getMediaTotalsForSession(session), listGenerationJobsForSession(session)]);
  const generation = describeGenerationAvailability();
  const isAnyJobWaiting = jobs.some((job) => (job.status === "queued" || job.status === "running") && !job.isStuck);

  return (
    <>
      <section className="grid gap-2">
        <h1 className="text-xl font-semibold">Media library</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Images and videos for your posts, uploaded by your team or made by an AI image service. Attach them to drafts
          in the{" "}
          <Link href="/cofounder/studio" className="underline">
            content studio
          </Link>
          . Everything here is private to your company: files open only for people logged in to it.
        </p>
        <p className="text-sm">
          {totals.count.toLocaleString("en-US")} of {MAX_MEDIA_ASSETS_PER_COMPANY} files, {formatFileSize(totals.totalBytes)} of{" "}
          {MAX_MEDIA_STORAGE_BYTES_PER_COMPANY / (1024 * 1024)} MB.
        </p>
      </section>

      <section className="grid gap-3" aria-labelledby="media-upload">
        <h2 id="media-upload" className="text-lg font-semibold">
          Upload
        </h2>
        <MediaUploadForm />
      </section>

      <section className="grid gap-3" aria-labelledby="media-generate">
        <h2 id="media-generate" className="text-lg font-semibold">
          Generate an image
        </h2>
        {generation.available ? (
          <>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {generation.isStandIn
                ? "In development a stand-in makes the images: a flat colour picked from your words, so you can try the whole flow. Nothing is sent anywhere."
                : "An AI image service makes it from your words, in a minute or so. Everything it makes is marked as AI-generated."}{" "}
              Your company can ask for 30 images and videos a day.
            </p>
            <GenerateMediaForm makesVideo={generation.makesVideo} isStandIn={generation.isStandIn} />
          </>
        ) : (
          <p className="max-w-3xl rounded-lg border p-3 text-sm">
            Image generation isn&apos;t set up yet. You can still upload your own images and videos above.
          </p>
        )}
      </section>

      {jobs.length > 0 && (
        <section className="grid gap-3" aria-labelledby="media-requests">
          <h2 id="media-requests" className="text-lg font-semibold">
            Requests
          </h2>
          <p className="text-sm text-muted-foreground">The newest 20 images and videos asked of the AI.</p>
          <GenerationJobList jobs={jobs} pageOnScreen={page} />
          <RefreshWhilePending isPending={isAnyJobWaiting} />
        </section>
      )}

      <section className="grid gap-3" aria-labelledby="media-library">
        <h2 id="media-library" className="text-lg font-semibold">
          Library
        </h2>
        {assets.length > 0 ? (
          <MediaGrid assets={assets} />
        ) : (
          <p className="rounded-lg border p-6 text-center text-muted-foreground">
            {page > 1 ? (
              <>
                Nothing on this page.{" "}
                <Link href="/cofounder/media" className="underline">
                  Go to the first page
                </Link>
              </>
            ) : (
              "No images or videos yet. Upload one, or ask the AI for an image."
            )}
          </p>
        )}
        <PaginationLinks basePath="/cofounder/media" page={page} totalRows={totals.count} />
      </section>
    </>
  );
}
