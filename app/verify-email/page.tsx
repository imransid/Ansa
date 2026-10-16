import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VerifyEmail } from "./verify-email";

export const metadata: Metadata = { title: "Confirm your email - ansa" };

// The token is after "#" in the link, which the server never sees (so it never
// lands in request logs). VerifyEmail reads it in the browser and sends it to a
// server action.
export default function VerifyEmailPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
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
