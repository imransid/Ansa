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
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Sign up - ansa" };

export default function SignupPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      {/* Already logged in: to the app, instead of a form that would start a
          second company. Reads the session, so it sits in <Suspense>. */}
      <Suspense fallback={null}>
        <RedirectIfLoggedIn />
      </Suspense>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your company</CardTitle>
          <CardDescription>
            You will be the owner. You can invite teammates later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm />
        </CardContent>
      </Card>
    </main>
  );
}
