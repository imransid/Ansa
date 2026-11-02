import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { DishForm } from "@/components/menu/dish-form";
import { DishRow } from "@/components/menu/dish-row";
import { PageLoading } from "@/components/page-loading";
import { buttonVariants } from "@/components/ui/button";
import { getMenuFromCore } from "@/lib/core-views/menu";
import { groupByCategory } from "@/lib/menu";
import { requireSessionContext } from "@/lib/session";

export const metadata: Metadata = { title: "Menu - ansa" };

// Settings → What it knows → Menu (step 46): the dishes ansa offers, with
// their prices. Owners add, change, move and delete them, typed in or read
// from a photo ("Read my menu"); everyone marks a dish "Not available today".
export default function MenuPage({ searchParams }: PageProps<"/settings/menu">) {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      <div className="grid gap-1">
        <Link href="/settings/business" className="text-sm text-muted-foreground hover:underline">
          &larr; What it knows
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Menu</h1>
        <p className="text-muted-foreground">What ansa offers your customers, at your prices. It never quotes a dish or a price that isn&apos;t here.</p>
      </div>
      {/* Cache Components rule: the session is only known at request time. */}
      <Suspense fallback={<PageLoading />}>
        <Menu searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Menu({ searchParams }: Pick<PageProps<"/settings/menu">, "searchParams">) {
  await requireSessionContext("/settings/menu");
  const { added } = await searchParams;
  const menu = await getMenuFromCore();
  if (!menu.currency) {
    return (
      <p className="rounded-xl bg-attention-surface px-4 py-3 text-sm">
        Choose your currency first, in{" "}
        <Link href="/settings/business" className="font-semibold underline">
          What it knows
        </Link>
        : every price on the menu is in it.
      </p>
    );
  }
  const currency = menu.currency;
  const groups = groupByCategory(menu.items);
  const categories = groups.map((group) => group.category);
  return (
    <>
      {added === "1" && (
        <p role="status" className="rounded-xl bg-success-surface px-4 py-3 text-sm">
          The dishes you checked are on your menu.
        </p>
      )}
      {menu.canEdit && (
        <div className="grid gap-4">
          <Link href="/settings/menu/read" className={`${buttonVariants()} justify-self-start`}>
            Read my menu from a photo or file
          </Link>
          <details className="rounded-2xl border px-5 py-3 [&[open]]:pb-5">
            <summary className="cursor-pointer font-semibold">Add a dish by hand</summary>
            <div className="pt-4">
              <DishForm categories={categories} currency={currency} />
            </div>
          </details>
        </div>
      )}
      {groups.length === 0 ? (
        <EmptyState>
          Your menu is empty.{" "}
          {menu.canEdit ? "Read it from a photo of your menu, or add your dishes one by one." : "An owner adds the dishes."}
        </EmptyState>
      ) : (
        groups.map((group) => (
          <section key={group.category} className="grid gap-1">
            <h2 className="font-display text-2xl">{group.category}</h2>
            <ul className="divide-y border-y">
              {group.items.map((dish) => (
                <DishRow key={dish.id} dish={dish} currency={currency} categories={categories} canEdit={menu.canEdit} />
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
