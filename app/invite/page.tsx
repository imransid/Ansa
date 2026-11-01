import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { JoinForm } from "./join-form";

export const metadata: Metadata = { title: "Join your team - ansa" };

// The invite token is after "#" in the link, which the server never sees.
// JoinForm reads it in the browser and checks it with the server.
export default function InvitePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-4">
      <Link href="/" className="rounded-md">
        <BrandMark />
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Join your team</CardTitle>
        </CardHeader>
        <CardContent>
          <JoinForm />
        </CardContent>
      </Card>
    </main>
  );
}
