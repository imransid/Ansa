import { Suspense } from "react";
import type { Metadata } from "next";
import { RedirectIfLoggedIn } from "@/components/redirect-if-logged-in";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "./login-form";
import { PasswordResetNote } from "./password-reset-note";

export const metadata: Metadata = { title: "Log in - ansa" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      {/* Already logged in: straight on to the app. It reads the session,
          which is only known at request time, so it sits in <Suspense>; the
          form around it is still built ahead of time. */}
      <Suspense fallback={null}>
        <RedirectIfLoggedIn searchParams={searchParams} />
      </Suspense>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Log in</CardTitle>
          <CardDescription>Use your work email and password.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* The note reads ?reset= from the URL, which is only known in the
              browser, so the rest of the page can still be built ahead of time. */}
          <Suspense fallback={null}>
            <PasswordResetNote />
          </Suspense>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
