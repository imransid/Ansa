import { Skeleton } from "@/components/ui/skeleton";

// What a page shows while its content streams in (the <Suspense> fallback of
// Home, Inbox and Settings): the rough shape of a heading and a few rows, so
// the page doesn't jump from one word to a full screen, and "Loading..." for
// screen readers.
export function PageLoading() {
  return (
    <div role="status" className="grid gap-4">
      <span className="sr-only">Loading...</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72 max-w-full" />
      <div className="grid gap-2 pt-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    </div>
  );
}
