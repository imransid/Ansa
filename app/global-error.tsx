"use client";

import { Geist } from "next/font/google";
import { SomethingWentWrong } from "@/components/something-went-wrong";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

type GlobalErrorProps = {
  error: unknown;
  retry: () => void;
};

// Shown when even the root layout failed. It replaces the whole document, so
// it brings its own <html>, <body>, styles and font (app/layout.tsx can't
// help here), and looks like the rest of the app instead of Next.js's card.
export default function GlobalError({ error, retry }: GlobalErrorProps) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <title>Something went wrong - ansa</title>
        <main className="flex flex-1 items-center justify-center p-6">
          <SomethingWentWrong error={error} retry={retry} />
        </main>
      </body>
    </html>
  );
}
