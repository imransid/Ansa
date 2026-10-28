import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireSessionContext } from "@/lib/session";
import { accountsPageResultSchema } from "@/lib/validation/social";
import { getSocialAccountsPageForSession } from "@/services/social-accounts";
import { ConnectResultMessage } from "./connect-result-message";
import { PlatformSection } from "./platform-section";

export const metadata: Metadata = { title: "Accounts - Co-Founder - ansa" };

export default function AccountsPage({ searchParams }: PageProps<"/cofounder/accounts">) {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-8 p-6">
      {/* Cache Components rule: the session and the URL's ?result= are only
          known at request time, so both are read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <AccountsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// The company's social accounts (step 40): per platform what it takes,
// whether ansa has set it up, and the connected accounts. Owners connect
// and disconnect; members see it all. ?result= is what the last return
// from a platform came to (services/social-oauth-callback.ts).
async function AccountsContent({ searchParams }: Pick<PageProps<"/cofounder/accounts">, "searchParams">) {
  const session = await requireSessionContext("/cofounder/accounts");
  const query = await searchParams;
  const result = accountsPageResultSchema.safeParse({ result: query.result, platform: query.platform, count: query.count });
  const page = await getSocialAccountsPageForSession(session);

  return (
    <>
      <section className="grid gap-2">
        <h1 className="text-xl font-semibold">Social accounts</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          The accounts the Co-Founder will publish your posts to. It only ever publishes drafts an owner approved in the{" "}
          <Link href="/cofounder/studio" className="underline">
            content studio
          </Link>
          . Connecting opens the platform&apos;s own page, where you say what ansa may do; the access it gives is stored
          encrypted and never shown to anyone.
        </p>
        {!page.canManage && <p className="text-sm">Only owners connect and disconnect accounts.</p>}
        {result.success && <ConnectResultMessage result={result.data.result} platform={result.data.platform} count={result.data.count ?? null} />}
      </section>

      {page.platforms.map((platform) => (
        <PlatformSection key={platform.platform} platform={platform} canManage={page.canManage} showsOperatorNotes={page.showsOperatorNotes} />
      ))}
    </>
  );
}
