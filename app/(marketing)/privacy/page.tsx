import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy policy - ansa" };

// Describes what the code really stores and sends. When that changes (a new
// provider, a new kind of data), update this page in the same change.
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        {site.name} is provided by {site.legalName} (&quot;we&quot;). This policy explains what we store, why, who helps us run
        the service, and what you can ask of us.
      </p>

      <h2>Two kinds of data</h2>
      <p>
        <strong>Your account.</strong> When a company signs up, we are responsible for the account data of its team.
      </p>
      <p>
        <strong>Your customers&apos; data.</strong> Calls, emails and tickets about your customers belong to your company. We
        process them only to provide the service to you, on your instructions. Your company decides what is collected
        from its customers and must tell them, for example that calls are answered by an AI agent and recorded.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>Team accounts: name, work email, role, and a one-way hash of the password (never the password itself).</li>
        <li>Company setup: company name, phone number ids, support addresses, categories, reply-to address, and documents you upload.</li>
        <li>Calls: the caller&apos;s phone number, times and duration, the transcript, the recording, and the AI&apos;s summary and decision.</li>
        <li>Emails: the sender&apos;s name and address, the subject and the text.</li>
        <li>Tickets: what the request is about, the customer&apos;s name, email or phone if known, who handles it, and its status.</li>
        <li>Emails we send to your customers when a ticket is solved: the address, and whether it was delivered.</li>
        <li>Billing: Stripe&apos;s ids for your customer record and subscription, and its status. No card details.</li>
      </ul>
      <p>
        Transcripts and email contents are encrypted in our database. Recordings and documents are kept in private storage
        and only open through links that stop working after a few minutes.
      </p>

      <h2>Why we use it</h2>
      <ul>
        <li>To run the service: answer calls, turn requests into tickets, route them, and email customers when solved.</li>
        <li>To keep it secure: limit repeated attempts and abuse, and find errors. Our logs never contain call or email content.</li>
        <li>To bill companies that subscribe.</li>
      </ul>
      <p>We do not sell data, show ads, or use tracking or analytics cookies.</p>

      <h2>Who helps us run the service</h2>
      <ul>
        <li>Vapi: answers phone calls and makes transcripts and recordings.</li>
        <li>Anthropic: its AI reads excerpts of call transcripts (with card numbers removed) and the text of support emails, to summarise and route them.</li>
        <li>Resend: sends and receives email.</li>
        <li>Cloudflare: stores recordings and documents.</li>
        <li>Neon: hosts our database.</li>
        <li>Stripe: handles payments.</li>
        <li>Our hosting provider: runs the application.</li>
      </ul>
      <p>Each one receives only what it needs for its part, under its own terms.</p>

      <h2>Cookies</h2>
      <p>We only use cookies that keep you logged in. They are needed for the service to work.</p>

      <h2>How long we keep it</h2>
      <p>
        We keep data while the company&apos;s account is open. Expired logins, expired confirmation links and old
        security counters are deleted automatically. To delete an account or specific data, write to us and we will do
        it.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see, correct, export or delete your data. If you are a customer of a company that uses {site.name},
        please contact that company first; we will help them answer you. Write to {site.contactEmail}.
      </p>

      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we will tell account owners by email before it applies.</p>
    </LegalPage>
  );
}
