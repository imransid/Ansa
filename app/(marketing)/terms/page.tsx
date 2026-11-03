import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { site } from "@/lib/site";
import { WEBSITE_PACKAGES } from "@/lib/website-packages";

export const metadata: Metadata = { title: "Terms of service - ansa" };

// Rewritten in step 58 for ansa as it is now: it answers for a business or
// a person, takes orders, posts, and comes in packages after a free trial.
export default function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <p>
        These terms are an agreement between {site.legalName} (&quot;we&quot;) and the business or person that creates an
        account (&quot;you&quot;). By creating an account you accept them, for yourself or on behalf of your business.
      </p>

      <h2>The service</h2>
      <p>
        {site.name} answers your messages and calls when you can&apos;t, as your AI assistant: from the information and
        instructions you give it, it answers what it can, takes orders, passes the rest on to you as requests, and tells
        you what you missed. It also turns emails you forward into requests and routes them to your team, emails a
        customer when their request is solved, can write and publish posts on your Facebook Page, and offers tools to
        plan, write and publish social media posts on the accounts your owners connect.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>The owners of your account decide who joins, and are responsible for what your team does in it.</li>
        <li>Keep passwords safe and tell us straight away if you think your account was misused.</li>
      </ul>

      <h2>Your responsibilities</h2>
      <ul>
        <li>
          Give ansa correct information: your prices, hours, menu, notes and instructions are what it answers from.
        </li>
        <li>
          Tell the people who contact you what the law requires, for example that an AI answers (ansa&apos;s first message
          to someone always says so) and that calls may be recorded.
        </li>
        <li>Have the right to process the data of the people who contact you.</li>
        <li>
          Connect only accounts and numbers you may use, and follow the rules of each platform you connect (Telegram,
          Meta&apos;s for Messenger and WhatsApp Business, LinkedIn, X and YouTube), including when a business may reply.
        </li>
        <li>Don&apos;t use the service for anything unlawful, for unsolicited messages, calls or email, or to harm others.</li>
        <li>Upload only images and videos you have the right to use and publish.</li>
      </ul>

      <h2>AI makes mistakes</h2>
      <p>
        The AI can misunderstand someone or answer wrongly, even from the information you gave it. ansa checks its
        replies for made-up prices, links and refund promises, works out every order total itself, and passes on to you
        what it isn&apos;t sure of; but no check catches everything, and when ansa replies on its own, a wrong answer can
        still reach the people who contact you. Choose &ldquo;Ask me first&rdquo; to approve each reply before it goes. Check each new order before
        you accept it. You remain responsible for what your business says and publishes, also for a post ansa or an
        auto-publish rule publishes without an approval of its own. A marketing plan or a performance review is advice,
        not a promise of results. When a platform answers unclearly, we never send a post again by itself; an owner
        checks the platform.
      </p>

      <h2>Your data</h2>
      <p>Your data stays yours. We use it only to provide the service, as described in our privacy policy.</p>

      <h2>Packages and payment</h2>
      <p>
        A new account starts with a free trial of {WEBSITE_PACKAGES.trialDays} days, with no card. After it, ansa keeps
        receiving your messages and sends your holding reply, but answers with the AI only once you choose a package.
        Packages are paid monthly in advance through Stripe and renew until cancelled. Each includes a number of AI
        replies and call minutes per calendar month: when they run out, ansa stops answering with the AI until the next
        month, and sends your holding reply or takes a caller&apos;s message instead; nothing extra is ever charged. You can change or cancel your package
        at any time on the Billing page; it keeps working until the end of the month you paid for. Replies written with
        your own Claude API key are paid to Anthropic under your own account with them. We will tell you before any price
        change applies to you.
      </p>

      <h2>Availability</h2>
      <p>
        We work to keep the service running, but we can&apos;t promise it will never be interrupted, including when a
        provider or platform we rely on has a problem, or limits or ends ansa&apos;s access to it.
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
