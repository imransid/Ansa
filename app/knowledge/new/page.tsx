import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireSessionContext } from "@/lib/session";
import { getSolvedTicketForArticleForSession } from "@/services/knowledge";
import { ArticleForm, type ArticleFormValues } from "../article-form";

export const metadata: Metadata = { title: "New article - ansa" };

export default function NewArticlePage({ searchParams }: PageProps<"/knowledge/new">) {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      {/* Cache Components rule: the session and ?fromTicket= are only known
          at request time, so both are read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <NewArticleContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const EMPTY_ARTICLE: ArticleFormValues = { title: "", kind: "faq", body: "", useForSupport: true, useForMarketing: false };

// A new draft, written by anyone in the company. From "Save as knowledge" on
// a solved ticket (?fromTicket=<number>): the title starts as the ticket's
// subject and the kind as "Solution to a problem". The number is only a
// claim: another company's ticket, or one that isn't solved, gives the plain form.
async function NewArticleContent({ searchParams }: Pick<PageProps<"/knowledge/new">, "searchParams">) {
  const { fromTicket } = await searchParams;
  const session = await requireSessionContext("/knowledge/new");
  const ticket = await getSolvedTicketForArticleForSession(session, fromTicket);
  const initial: ArticleFormValues = ticket ? { ...EMPTY_ARTICLE, title: ticket.subject, kind: "solution" } : EMPTY_ARTICLE;

  return (
    <>
      <Link href={ticket ? `/tickets/${ticket.ticketNumber}` : "/knowledge"} className="text-sm hover:underline">
        &larr; {ticket ? `Ticket #${ticket.ticketNumber}` : "All knowledge"}
      </Link>
      <section className="grid gap-2">
        <h1 className="text-xl font-semibold">{ticket ? `Save ticket #${ticket.ticketNumber} as knowledge` : "New article"}</h1>
        <p className="text-sm text-muted-foreground">
          {ticket
            ? "Write down how this kind of problem is solved, so the next customer gets the answer faster. The ticket itself is not copied."
            : "It is saved as a draft. The AI uses it only once an owner approves it."}
        </p>
      </section>
      <ArticleForm mode="create" initial={initial} fromTicket={ticket?.ticketNumber ?? null} />
    </>
  );
}
