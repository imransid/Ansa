import { Suspense } from "react";
import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { requireSessionContext } from "@/lib/session";
import { getDashboardSummary } from "@/services/dashboard";
import { listDocumentsForSession } from "@/services/documents";
import { getSetupForSession } from "@/services/setup";
import { InboundAddressForm, LinkedValues, PhoneLineForm } from "./channel-forms";
import { Checklist } from "./checklist";
import { DocumentsSection } from "./documents-section";
import { ReplyToForm } from "./reply-to-form";

export const metadata: Metadata = { title: "Setup - ansa" };

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
  const session = await requireSessionContext();
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
      <AppHeader summary={summary} />
      <section className="grid gap-3">
        <h1 className="text-xl font-semibold">Setup</h1>
        {!isOwner && <p className="text-sm text-muted-foreground">Only owners can change these settings.</p>}
        <Checklist setup={setup} />
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Reply-to address</h2>
        <p className="text-sm text-muted-foreground">
          When a customer replies to a &quot;solved&quot; email, their reply goes here. Leave empty to send replies nowhere.
        </p>
        {isOwner ? <ReplyToForm current={setup.replyToEmail} /> : <p className="text-sm">{setup.replyToEmail ?? "Not set"}</p>}
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Phone numbers</h2>
        <p className="text-sm text-muted-foreground">
          Calls to these Vapi numbers belong to your company. Paste the phone number id from the Vapi dashboard.
        </p>
        <LinkedValues kind="phone" values={setup.phoneLines} canRemove={isOwner} />
        {isOwner && <PhoneLineForm />}
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Support email addresses</h2>
        <p className="text-sm text-muted-foreground">
          Emails sent to these addresses become tickets. The address must receive mail through our email provider.
        </p>
        <LinkedValues kind="address" values={setup.inboundAddresses} canRemove={isOwner} />
        {isOwner && <InboundAddressForm />}
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Documents</h2>
        <p className="text-sm text-muted-foreground">
          Your help articles, policies and price lists. Stored privately. The AI does not read them yet.
        </p>
        <DocumentsSection documents={documents} canManage={isOwner} />
      </section>
    </>
  );
}
