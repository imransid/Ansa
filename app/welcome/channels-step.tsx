import Link from "next/link";
import { completeChannelsStepAction } from "@/app/actions/restaurant-setup";
import { CopyButton } from "@/app/setup/copy-button";
import { ActionButtonForm } from "@/components/restaurant-setup/action-button-form";
import { buttonVariants } from "@/components/ui/button";
import { requireSessionContext } from "@/lib/session";
import { getSetupForSession } from "@/services/setup";

// Setup step 6: where messages reach ansa. Email works today through the
// company's forwarding address; ansa links phone numbers itself; Telegram
// connects on Settings → Connections (step 48); Messenger comes with step 53,
// so the step says so instead of offering a button that does nothing.
export async function ChannelsStep({ backHref }: { backHref: string }) {
  const session = await requireSessionContext("/welcome");
  const setup = await getSetupForSession(session);
  return (
    <div className="grid gap-6">
      <ul className="divide-y border-y">
        <li className="grid gap-2 py-4">
          <h2 className="font-semibold">Email</h2>
          <p className="text-sm text-muted-foreground">
            Forward your email to this address, and the emails arrive in your Inbox as notes for you.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-muted px-3 py-2 text-sm break-all">{setup.forwardingAddress}</code>
            <CopyButton text={setup.forwardingAddress} label="Copy" />
          </div>
        </li>
        <li className="grid gap-2 py-4">
          <h2 className="font-semibold">Phone</h2>
          <p className="text-sm text-muted-foreground">
            {setup.phoneLines.length > 0
              ? `ansa answers ${setup.phoneLines.length === 1 ? "your phone number" : `your ${setup.phoneLines.length} phone numbers`}.`
              : "ansa sets up a phone number for you: contact ansa when you want calls answered."}
          </p>
        </li>
        <li className="grid gap-2 py-4">
          <h2 className="font-semibold">Telegram</h2>
          <p className="text-sm text-muted-foreground">
            Add ansa as your Telegram Business chatbot, and the Telegram messages people send you arrive in your Inbox.
          </p>
          <Link href="/settings/channels" className="justify-self-start text-sm font-medium underline">
            Connect Telegram in Settings → Connections
          </Link>
        </li>
        <li className="grid gap-2 py-4">
          <h2 className="font-semibold">Facebook Messenger</h2>
          <p className="text-sm text-muted-foreground">
            Connect your business&apos;s Facebook Page, and the messages people send it arrive in your Inbox.
          </p>
          <Link href="/settings/channels" className="justify-self-start text-sm font-medium underline">
            Connect Messenger in Settings → Connections
          </Link>
        </li>
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={backHref} className={buttonVariants({ variant: "ghost" })}>
          Back
        </Link>
        <ActionButtonForm action={completeChannelsStepAction} label="Continue" />
      </div>
    </div>
  );
}
