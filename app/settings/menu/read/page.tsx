import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { MenuReader } from "@/components/menu/menu-reader";
import { PageLoading } from "@/components/page-loading";
import { getMenuFromCore } from "@/lib/core-views/menu";
import { requireSessionContext } from "@/lib/session";

export const metadata: Metadata = { title: "Read my menu - ansa" };

// Reading a menu waits for Claude (two tries of up to 2 minutes, the
// brain's MENU_READING in brain/brain/ai.py).
export const maxDuration = 300;

// "Read my menu" (step 46): a photo, a file or pasted text becomes a list of
// dishes to check; "Looks right" adds them. Owners only.
export default function ReadMenuPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      <div className="grid gap-1">
        <Link href="/settings/menu" className="text-sm text-muted-foreground hover:underline">
          &larr; Menu
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Read my menu</h1>
        <p className="text-muted-foreground">
          ansa reads the dishes and prices for you. You check every one before anything is added, and the prices stay exactly as you confirm them.
        </p>
      </div>
      {/* Cache Components rule: the session is only known at request time. */}
      <Suspense fallback={<PageLoading />}>
        <Reader />
      </Suspense>
    </main>
  );
}

async function Reader() {
  await requireSessionContext("/settings/menu/read");
  const menu = await getMenuFromCore();
  if (!menu.canEdit) {
    return <p className="text-sm text-muted-foreground">Only owners change the menu.</p>;
  }
  if (!menu.currency) {
    return (
      <p className="rounded-xl bg-attention-surface px-4 py-3 text-sm">
        Choose your currency first, in{" "}
        <Link href="/settings/business" className="font-semibold underline">
          What it knows
        </Link>
        : ansa reads the prices in it.
      </p>
    );
  }
  return <MenuReader currency={menu.currency} />;
}
