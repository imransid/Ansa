import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { site } from "@/lib/site";
import { WhatWeStore } from "./what-we-store";
import { WhoHelps } from "./who-helps";

export const metadata: Metadata = { title: "Privacy policy - ansa" };

// Describes what the code really stores and sends (rewritten in step 58 for
// ansa as it is now: chats, orders, calls, posts and packages). When that
// changes (a new provider, a new kind of data), update this page in the same
// change.
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        {site.name} is provided by {site.legalName} (&quot;we&quot;). This policy explains what we store, why, who helps us run
        the service, and what you can ask of us.
      </p>

      <h2>Two kinds of data</h2>
      <p>
        <strong>Your account.</strong> When a business or a person signs up, we are responsible for the account data of its
        team.
      </p>
      <p>
        <strong>The data of the people who contact you.</strong> The messages, calls, orders, emails and requests of your
        customers or contacts belong to your account. We process them only to provide the service to you, on your
        instructions. You decide what ansa may say and do for you, and you tell the people who contact you what the law
        requires; ansa&apos;s first message to someone always says it is an AI assistant.
      </p>

      <WhatWeStore />

      <h2>Why we use it</h2>
      <ul>
        <li>
          To run the service: answer messages and calls for you, take orders, pass on what ansa can&apos;t answer, route
          requests to your team, tell you what you missed, email customers when their request is solved, publish the
          posts you approve or let ansa post, and, if you turn it on, answer for you while your phone doesn&apos;t
          check in.
        </li>
        <li>To keep it secure: limit repeated attempts and abuse, and find errors. Our logs never contain messages, calls or emails.</li>
        <li>To bill accounts that choose a package, and to count what each package includes.</li>
      </ul>
      <p>We do not sell data, show ads, or use tracking or analytics cookies.</p>

      <WhoHelps />

      <h2>Cookies</h2>
      <p>
        We only use two kinds of cookies, both needed for the service to work and secure: one keeps you logged in, and
        one remembers for 90 days that your browser logged in to your account before, so that someone else trying wrong
        passwords on your account can&apos;t lock that browser out. Meta&apos;s sign-up window, which opens only when an
        owner connects WhatsApp Business, is Meta&apos;s own and follows Meta&apos;s cookie policy.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep data while the account is open. Expired logins and password reset links, unfinished connections to
        social platforms and to Telegram, old security counters, and our own finished background tasks (after 30 days)
        are deleted automatically. To delete an account or specific data, write to us and we will do it.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see, correct, export or delete your data. If you contacted a business or a person who uses{" "}
        {site.name}, please ask them first; we will help them answer you. Write to {site.contactEmail}.
      </p>

      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we will tell account owners by email before it applies.</p>
    </LegalPage>
  );
}
