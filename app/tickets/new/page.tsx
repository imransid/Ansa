import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireSessionContext } from "@/lib/session";
import { listActiveCategoriesForSession } from "@/services/categories";
import { NewTicketForm } from "./new-ticket-form";

export const metadata: Metadata = { title: "New ticket - ansa" };

export default function NewTicketPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      {/* Cache Components rule: the session is only known at request time,
          so it is read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <NewTicketContent />
      </Suspense>
    </main>
  );
}

// A ticket typed in by a person (step 31), for a request that reached the
// team some other way. Anyone in the company may create one.
async function NewTicketContent() {
  const session = await requireSessionContext("/tickets/new");
  const categories = await listActiveCategoriesForSession(session);

  return (
    <>
      <Link href="/dashboard" className="text-sm hover:underline">
        &larr; All tickets
      </Link>
      <section className="grid gap-2">
        <h1 className="text-xl font-semibold">New ticket</h1>
        <p className="text-sm text-muted-foreground">
          For a request that reached you another way: a voicemail on your own phone, a customer at the counter, a
          message on social media. It is routed like any other ticket.
        </p>
      </section>
      <NewTicketForm categories={categories} />
    </>
  );
}
