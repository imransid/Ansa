import type { Metadata } from "next";
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
    <main className="flex flex-1 items-center justify-center p-4">
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
