"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { verifyEmailAction } from "@/app/actions/auth";

type VerifyState = { status: "checking" } | { status: "failed"; message: string };

export function VerifyEmail() {
  const router = useRouter();
  const [state, setState] = useState<VerifyState>({ status: "checking" });

  useEffect(() => {
    // window.location.hash is "#<token>". Only the browser can read it.
    const token = window.location.hash.slice(1);
    verifyEmailAction(token).then((result) => {
      if (result.ok) {
        // Confirming also logged the user in.
        router.replace("/dashboard");
      } else {
        setState({ status: "failed", message: result.errors.message ?? "This link is not valid." });
      }
    });
  }, [router]);

  if (state.status === "checking") {
    return <p className="text-muted-foreground">Confirming your email address...</p>;
  }
  return (
    <div className="grid gap-3 text-sm">
      <p role="alert" className="text-destructive">
        {state.message}
      </p>
      <Link href="/login" className="underline">
        Go to log in
      </Link>
    </div>
  );
}
