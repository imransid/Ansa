import Link from "next/link";

// For a conversation the page can't show: unknown, mistyped, or only in
// another company. All look the same, so nothing tells whether another
// company has it. Shown inside the app's frame (app/inbox/layout.tsx).
export default function ConversationNotFound() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 p-6">
      <h1 className="text-xl font-semibold">We couldn&apos;t find that conversation</h1>
      <p className="text-sm text-muted-foreground">Your company has no conversation at that address. The link may be mistyped or out of date.</p>
      <Link href="/inbox" className="text-sm underline">
        &larr; Inbox
      </Link>
    </main>
  );
}
