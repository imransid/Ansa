import { Suspense } from "react";
import type { Metadata } from "next";
import { requireSessionContext } from "@/lib/session";
import { getAccountForSession } from "@/services/account";
import { NameForm, OtherDevicesForm, PasswordForm } from "./account-forms";

export const metadata: Metadata = { title: "Account - ansa" };

export default function AccountPage({ searchParams }: PageProps<"/account">) {
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 p-6">
      {/* Cache Components rule: the session and ?changed= are only known at
          request time, so both are read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <AccountContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

// Reads the session once and hands it to everything on the page.
async function AccountContent({ searchParams }: Pick<PageProps<"/account">, "searchParams">) {
  const passwordWasChanged = (await searchParams).changed === "password";
  const session = await requireSessionContext("/account");
  const account = await getAccountForSession(session);

  return (
    <>
      <section className="grid gap-3">
        <h1 className="text-xl font-semibold">Account</h1>
        <p className="text-sm">
          You log in as <strong>{account.email}</strong>. Changing your email address isn&apos;t possible yet.
        </p>
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Your name</h2>
        <p className="text-sm text-muted-foreground">Your teammates see it in the team list and on the tickets you handle.</p>
        <NameForm currentName={account.name} />
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Password</h2>
        {passwordWasChanged && (
          <p role="status" className="text-sm">
            Your new password is saved, and every other device was logged out.
          </p>
        )}
        <PasswordForm />
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Where you are logged in</h2>
        <p className="text-sm text-muted-foreground">
          {describeLogins(account.activeSessionCount)} A login ends 7 days after you log in.
        </p>
        <OtherDevicesForm />
      </section>
    </>
  );
}

function describeLogins(activeSessionCount: number): string {
  const otherCount = activeSessionCount - 1;
  if (otherCount <= 0) {
    return "You are logged in only here.";
  }
  if (otherCount === 1) {
    return "You are logged in here and on 1 other browser or device.";
  }
  return `You are logged in here and on ${otherCount} other browsers or devices.`;
}
