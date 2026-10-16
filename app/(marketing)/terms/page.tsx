import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of service - ansa" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <p>
        These terms are an agreement between {site.legalName} (&quot;we&quot;) and the company that creates an account
        (&quot;you&quot;). By creating an account you accept them on behalf of your company.
      </p>

      <h2>The service</h2>
      <p>
        {site.name} answers your support calls with an AI voice agent, turns support calls and emails into tickets, routes
        them to your team, and emails your customers when a ticket is solved.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>The owners of your account decide who joins, and are responsible for what your team does in it.</li>
        <li>Keep passwords safe and tell us straight away if you think your account was misused.</li>
      </ul>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Tell your callers, where the law requires it, that calls are answered by an AI agent and recorded.</li>
        <li>Have the right to process the data of the customers who contact you.</li>
        <li>Don&apos;t use the service for anything unlawful, for unsolicited calls or email, or to harm others.</li>
      </ul>

      <h2>AI makes mistakes</h2>
      <p>
        The AI can misunderstand a customer. When it isn&apos;t sure a problem was solved, it hands the call to your team,
        but you remain responsible for the answers your company gives its customers.
      </p>

      <h2>Your data</h2>
      <p>
        Your company&apos;s data stays yours. We use it only to provide the service, as described in our privacy policy.
      </p>

      <h2>Payment</h2>
      <p>
        Paid plans are billed in advance through Stripe and renew automatically until cancelled. You can cancel at any
        time on the Billing page; the plan keeps working until the end of the paid period. We will tell you before any
        price change applies to you.
      </p>

      <h2>Availability</h2>
      <p>
        We work to keep the service running, but we can&apos;t promise it will never be interrupted, including when a
        provider we rely on has a problem.
      </p>

      <h2>Ending the agreement</h2>
      <p>
        You can stop using the service at any time. We may suspend an account that breaks these terms. When an account
        closes, you can ask us to delete its data.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, we are not liable for indirect losses, and our total liability is limited to what
        you paid us in the twelve months before the claim.
      </p>

      <h2>Changes and law</h2>
      <p>
        We will tell account owners by email before changes to these terms apply. These terms are governed by the laws
        of {site.governingLaw}. Questions: {site.contactEmail}.
      </p>
    </LegalPage>
  );
}
