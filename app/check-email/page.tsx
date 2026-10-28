import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { describeLinkLifetime, VERIFICATION_LINK_SECONDS } from "@/lib/link-lifetimes";

export const metadata: Metadata = { title: "Check your email - ansa" };

// Shown after signing up or joining a team: the account exists, but there is
// no session until the email address is confirmed. Also shown, word for word,
// when the address already had an account, so the page never reveals that.
export default function CheckEmailPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p>We sent you a link to confirm your email address. Open it and enter your password to finish.</p>
          <p className="text-muted-foreground">
            If this address already has an account, we emailed you about that instead.
          </p>
          <p className="text-muted-foreground">
            The link works for {describeLinkLifetime(VERIFICATION_LINK_SECONDS)}. Didn&apos;t get it?{" "}
            <Link href="/login" className="underline">
              Log in
            </Link>{" "}
            and we&apos;ll send a new one.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
