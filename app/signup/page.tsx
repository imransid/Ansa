import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
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
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-4">
      {/* Already logged in: to the app, instead of a form that would start a
          second company. Reads the session, so it sits in <Suspense>. */}
      <Suspense fallback={null}>
        <RedirectIfLoggedIn />
      </Suspense>
      <Link href="/" className="rounded-md">
        <BrandMark />
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>
            Then you&apos;ll set ansa up for you or your business in about five minutes. You can invite a team later.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm />
        </CardContent>
      </Card>
    </main>
  );
}
