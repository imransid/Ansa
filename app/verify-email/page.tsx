import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VerifyEmail } from "./verify-email";

export const metadata: Metadata = { title: "Confirm your email - ansa" };

// The token is after "#" in the link, which the server never sees (so it never
// lands in request logs). VerifyEmail asks for the account's password, then
// sends both to a server action: the link alone confirms nothing.
export default function VerifyEmailPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-4">
      <Link href="/" className="rounded-md">
        <BrandMark />
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Confirm your email</CardTitle>
        </CardHeader>
        <CardContent>
          <VerifyEmail />
        </CardContent>
      </Card>
    </main>
  );
}
