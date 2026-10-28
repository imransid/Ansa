import Link from "next/link";

// For an article the page can't show: unknown, mistyped, deleted, or another
// company's. All look the same, so nothing tells whether another company has
// it. Shown below the app header (app/knowledge/layout.tsx).
export default function KnowledgeArticleNotFound() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 p-6">
      <h1 className="text-xl font-semibold">We couldn&apos;t find that article</h1>
      <p className="text-sm text-muted-foreground">
        Your company has no article at that address. It may have been deleted, or the link is mistyped or out of date.
      </p>
      <Link href="/knowledge" className="text-sm underline">
        &larr; All knowledge
      </Link>
    </main>
  );
}
