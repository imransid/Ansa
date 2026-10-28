import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { canManageKnowledge } from "@/lib/knowledge/permissions";
import { requireSessionContext } from "@/lib/session";
import { WebImportForm } from "./web-import-form";

export const metadata: Metadata = { title: "Import a web page - ansa" };

// The import's server action waits up to 10 seconds for the page, then turns
// it into drafts: the host's default time limit can be as short as 10 seconds.
export const maxDuration = 60;

export default function ImportWebPagePage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      {/* Cache Components rule: the session is only known at request time,
          so it is read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <ImportWebPageContent />
      </Suspense>
    </main>
  );
}

// "Import a web page" (step 34): one public page's text becomes drafts.
// Owners only (services/knowledge-web-import.ts refuses anyone else).
async function ImportWebPageContent() {
  const session = await requireSessionContext("/knowledge/import");
  const isOwner = canManageKnowledge(session.role);

  return (
    <>
      <Link href="/knowledge" className="text-sm hover:underline">
        &larr; All knowledge
      </Link>
      <section className="grid gap-2">
        <h1 className="text-xl font-semibold">Import a web page</h1>
        <p className="text-sm text-muted-foreground">
          Paste the address of one public page, such as your FAQ or returns policy. Its text becomes draft articles
          (links on it are not followed). Nothing is used until an owner reads and approves the drafts. Importing the
          same page again makes new drafts; a later change to the page is not copied.
        </p>
      </section>
      {isOwner ? (
        <WebImportForm />
      ) : (
        <p className="rounded-lg border p-4 text-sm">Only owners can import web pages. Ask an owner, or write a new article yourself.</p>
      )}
    </>
  );
}
