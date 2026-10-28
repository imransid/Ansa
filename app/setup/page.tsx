import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { requireSessionContext } from "@/lib/session";
import { getDashboardSummary } from "@/services/dashboard";
import { listDocumentsForSession } from "@/services/documents";
import { getSetupForSession } from "@/services/setup";
import { Checklist } from "./checklist";
import { CompanyNameForm } from "./company-name-form";
import { DocumentsSection } from "./documents-section";
import { EmailSection } from "./email-section";
import { PhoneSection } from "./phone-section";
import { ReplyToForm } from "./reply-to-form";

export const metadata: Metadata = { title: "Setup - ansa" };

// "Add to knowledge" reads a whole document (a PDF of up to 4 MB) inside this
// page's server action: the host's default time limit can be as short as 10
// seconds.
export const maxDuration = 60;

export default function SetupPage() {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6">
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <SetupContent />
      </Suspense>
    </main>
  );
}

async function SetupContent() {
  const session = await requireSessionContext("/setup");
  const [summary, setup, documents] = await Promise.all([
    getDashboardSummary(session),
    getSetupForSession(session),
    listDocumentsForSession(session),
  ]);
  // Hiding the forms is only for a tidy page. services/setup.ts and
  // services/documents.ts refuse non-owners.
  const isOwner = session.role === "owner";

  return (
    <>
      <section className="grid gap-3">
        <h1 className="text-xl font-semibold">Setup</h1>
        {!isOwner && <p className="text-sm text-muted-foreground">Only owners can change these settings.</p>}
        <Checklist setup={setup} />
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Company name</h2>
        <p className="text-sm text-muted-foreground">
          Customers see it in the sender of every email we send for you (&quot;{summary.companyName} via ansa&quot;).
        </p>
        {isOwner ? <CompanyNameForm current={summary.companyName} /> : <p className="text-sm">{summary.companyName}</p>}
      </section>

      <EmailSection setup={setup} isOwner={isOwner} />

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Reply-to address</h2>
        <p className="text-sm text-muted-foreground">
          When a customer replies to a &quot;solved&quot; email, the reply goes to this address. Leave it empty and replies
          go to your forwarding address, so they become new tickets here (not added to the solved one).
        </p>
        {isOwner ? (
          <ReplyToForm current={setup.replyToEmail} />
        ) : (
          <p className="text-sm">{setup.replyToEmail ?? "Not set: replies go to the forwarding address"}</p>
        )}
      </section>

      <PhoneSection phoneLines={setup.phoneLines} />

      <section className="grid gap-3">
        <h2 id="documents" className="text-lg font-semibold">
          Documents
        </h2>
        <p className="text-sm text-muted-foreground">
          Your help articles, policies and price lists, stored privately. The AI never reads a file itself: &ldquo;Add
          to knowledge&rdquo; (owners) turns its text into draft{" "}
          <Link href="/knowledge" className="underline">
            knowledge
          </Link>{" "}
          articles, used only once an owner approves them. Adding the same file again makes new drafts. A scanned PDF
          has no text to add.
        </p>
        <DocumentsSection documents={documents} canManage={isOwner} />
      </section>
    </>
  );
}
