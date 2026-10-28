import { Suspense } from "react";
import type { Metadata } from "next";
import { PaginationLinks } from "@/components/pagination-links";
import { parsePageNumber } from "@/lib/pagination";
import { requireSessionContext } from "@/lib/session";
import { countInboundEmailsForSession, listInboundEmailsForSession } from "@/services/inbound-emails";
import { countUndeliveredCustomerEmailsForSession, listUndeliveredCustomerEmailsForSession } from "@/services/undelivered-emails";
import { InboundEmailTable } from "./inbound-email-table";
import { UndeliveredCustomerEmails } from "./undelivered-emails";

export const metadata: Metadata = { title: "Emails - ansa" };

// "Process again" and "Make a ticket anyway" can ask Claude inside this
// page's server actions (up to 3 tries of 60 s): the host's default time
// limit can be as short as 10 seconds.
export const maxDuration = 300;

export default function EmailsPage({ searchParams }: PageProps<"/emails">) {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6">
      {/* Cache Components rule: the session and ?page= are only known at
          request time, so both are read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <EmailsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function EmailsContent({ searchParams }: Pick<PageProps<"/emails">, "searchParams">) {
  const page = parsePageNumber((await searchParams).page);
  const session = await requireSessionContext("/emails");
  const [emails, totalEmails, undelivered, totalUndelivered] = await Promise.all([
    listInboundEmailsForSession(session, page),
    countInboundEmailsForSession(session),
    listUndeliveredCustomerEmailsForSession(session),
    countUndeliveredCustomerEmailsForSession(session),
  ]);

  return (
    <>
      <h1 className="text-xl font-semibold">Emails</h1>
      <UndeliveredCustomerEmails emails={undelivered} total={totalUndelivered} />
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Received</h2>
        <p className="text-sm text-muted-foreground">
          Every email that reached your forwarding address, and what became of it. Automatic replies, bulk mail, bounces,
          floods from one sender and mail from your own support addresses are skipped; you can still make any of them a
          ticket.
        </p>
        <InboundEmailTable emails={emails} page={page} />
        <PaginationLinks basePath="/emails" page={page} totalRows={totalEmails} />
      </section>
    </>
  );
}
