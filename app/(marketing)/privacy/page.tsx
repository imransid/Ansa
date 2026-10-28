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
        <li>
          Knowledge articles your team writes, or imports from those documents or from public web pages it names: their
          text, where they came from, and who wrote, changed and approved them. To import a page, our server fetches
          that one page.
        </li>
        <li>
          Calls: the caller&apos;s phone number, times and duration, the transcript, the recording, the AI&apos;s summary
          and decision (for a call it judged solved, the customer&apos;s sentence that confirmed it), and who on your team
          escalated a call to a ticket, if anyone did.
        </li>
        <li>
          Emails: the sender&apos;s name and address, a different reply-to address if the email gives one, whether the
          sender passed the receiving server&apos;s authenticity checks, the subject, the text (taken from the formatted
          version when there is no plain one), how many attachments it had and their file names, and how many images
          it showed inside its text (not the files themselves). For an email that doesn&apos;t become a ticket (an
          automatic reply, a newsletter): only the sender&apos;s address and why.
        </li>
        <li>
          Tickets, including the ones your team types in: what the request is about, the customer&apos;s name, email or
          phone if known, who handles it, its status, the notes your team adds, and a history of who changed what and
          when.
        </li>
        <li>
          Your business profile for the AI Co-Founder: facts about your business that your owners confirm or type in,
          the facts the AI proposes until an owner confirms or dismisses them, who confirmed each and when, and the
          Co-Founder&apos;s interview: its questions and your owners&apos; answers.
        </li>
        <li>
          Marketing plans the Co-Founder writes: every version, who asked for it and when, the note they gave it, and
          what it was made from (the confirmed facts, the knowledge articles it read, and whether it saw your support
          trends).
        </li>
        <li>
          Social media drafts in the Co-Founder&apos;s content studio: the platform, topic and text of each post, its
          hashtags, the claims it makes about your business and which confirmed facts back them, who wrote, changed,
          approved or rejected it and when, and what the AI wrote it from.
        </li>
        <li>
          Images and videos your team uploads to the Co-Founder&apos;s media library: the files, their names, the
          description your team writes of what each shows, who added each and when, and which drafts use them.
        </li>
        <li>
          Social media accounts your owners connect for the Co-Founder (LinkedIn, Facebook Pages, X, YouTube): the
          account&apos;s name and id on that platform, the permissions it gave, the access it gave us and when that
          runs out, who connected it last and when, and when it was disconnected.
        </li>
        <li>
          Posts your owners schedule to those accounts: which draft goes to which account and when, who scheduled or
          canceled it, what became of it (the platform&apos;s id and address of the post, or a short code saying why it
          didn&apos;t go out), your owners&apos; auto-publish rules, the days the content calendar plans drafts for, and a
          log of who did what with your accounts, drafts, posts, rules and plans, and when (never a post&apos;s text or
          the access an account gave us).
        </li>
        <li>
          The numbers the platforms give about those posts (views, reach, reactions, comments, shares, clicks and video
          views, as each platform counts them), read about once a day for up to 30 days after a post went out, and the
          performance reviews your owners ask the Co-Founder for: the numbers each one read and what it found.
        </li>
        <li>Emails we send to your customers when a ticket is solved: the address, and whether it was delivered.</li>
        <li>Billing: Stripe&apos;s ids for your customer record and subscription, and its status. No card details.</li>
      </ul>
      <p>
        Transcripts and the AI&apos;s notes about calls, email contents (including attachment names), ticket notes,
        the Co-Founder interview&apos;s messages and the access social platforms give us are encrypted in our
        database; that access is never shown to anyone, your team included. Knowledge articles are stored as plain
        text so they can be searched: they are reference text written for every customer, and the forms ask your
        team to keep customer details out of them. Business profile facts and marketing plans are stored as plain
        text too, and so are content drafts, post numbers and performance reviews: they are your company&apos;s own
        information about itself and its marketing. Recordings, documents and media files are kept in private storage
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
        <li>
          Anthropic: its AI reads excerpts of call transcripts (with card numbers removed) and the text of support
          emails, to summarise and route them; and, for the Co-Founder, your business profile, the latest interview
          messages and the knowledge articles your owners pick, to propose facts about your business, and the
          confirmed facts, approved marketing articles and your owners&apos; note, to write a marketing plan, and the
          confirmed facts, approved marketing articles, your plan&apos;s audiences and themes and the topic your team
          picks, to write a social media draft, and your plan&apos;s themes, campaigns and posting rhythm with the
          topics already planned, to plan two weeks of post ideas, and your posts&apos; numbers with their topics,
          platforms and the day and hour they went out, to review how they did (the newest review also goes to the
          next marketing plan). Only if
          an owner turns it on does a plan also get how many support tickets each category had in the last 30 days:
          category names and numbers, never a ticket&apos;s text or a customer&apos;s details.
        </li>
        <li>Resend: sends and receives email.</li>
        <li>
          LinkedIn, Meta (Facebook), X and Google (YouTube): only for the accounts your owners connect there. The
          platform tells us the account&apos;s name and id and gives us access to it, gets each post your owners
          schedule there (its text, title and image or video, published in your account&apos;s name), and tells us that
          post&apos;s numbers when we ask; when an account
          is disconnected we delete that access, and ask X and Google to take it back too, unless another company
          using ansa still has the same account connected (taking it back would end theirs).
        </li>
        <li>Cloudflare: stores recordings, documents and media files.</li>
        <li>Neon: hosts our database.</li>
        <li>Stripe: handles payments.</li>
        <li>Our hosting provider: runs the application.</li>
      </ul>
      <p>Each one receives only what it needs for its part, under its own terms.</p>

      <h2>Cookies</h2>
      <p>
        We only use two kinds of cookies, both needed for the service to work and secure: one keeps you logged in, and
        one remembers for 90 days that your browser logged in to your account before, so that someone else trying wrong
        passwords on your account can&apos;t lock that browser out.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep data while the company&apos;s account is open. Expired logins, expired password reset links,
        unfinished social account connections and old security counters are deleted automatically. To delete an account or specific data, write to us and we will do
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
