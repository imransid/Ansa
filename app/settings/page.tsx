import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, LogOut } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { PageLoading } from "@/components/page-loading";
import { Button } from "@/components/ui/button";
import { getSetupStateFromCore } from "@/lib/core-views/restaurant-setup";
import { requireSessionContext } from "@/lib/session";

export const metadata: Metadata = { title: "Settings - ansa" };

type SettingsLink = { href: string; label: string; description: string };

// What ansa answers with and where: the pages most people need.
const ASSISTANT_LINKS: SettingsLink[] = [
  { href: "/settings/assistant", label: "Assistant", description: "When and how ansa answers, and a place to try it." },
  { href: "/settings/channels", label: "Connections", description: "WhatsApp, Telegram, Facebook, email, phone and social media: everywhere ansa answers and posts." },
  { href: "/settings/business", label: "What it knows", description: "Your business, address, opening hours, orders and payment." },
  { href: "/settings/menu", label: "Menu and prices", description: "What you sell and what it costs, typed in or read from a photo." },
  { href: "/settings/posts", label: "Posts for me", description: "ansa plans, writes and posts on your Facebook Page by itself." },
];

// A person (step 50) has no menu, and "What it knows" is about them. Email
// forwarding is Connections' email section: the Setup page is a support
// desk's (a team checklist, support addresses).
const PERSONAL_ASSISTANT_LINKS: SettingsLink[] = [
  { href: "/settings/assistant", label: "Assistant", description: "When and how ansa answers for you, and a place to try it." },
  { href: "/settings/channels", label: "Connections", description: "WhatsApp, Telegram, Facebook Messenger and email: where people write to you." },
  { href: "/settings/business", label: "About you", description: "Who you are, and what ansa may tell people about you." },
  { href: "/knowledge", label: "Saved answers", description: "Longer answers ansa can give: notes, documents and web pages." },
  { href: "/settings/channels#email-heading", label: "Email forwarding", description: "Forward your email to ansa: each email becomes a note in your inbox." },
];

// The rest of a business's tools, one click further. Social media posts
// leads on to the media library, the scheduled posts and the Marketing
// planner (step 58: the pages "Older pages" held until then).
const MORE_LINKS: SettingsLink[] = [
  { href: "/cofounder/studio", label: "Social media posts", description: "Posts for Facebook, LinkedIn, X and YouTube, written with ansa and approved by you." },
  { href: "/cofounder/accounts", label: "Social media accounts", description: "The accounts your posts go to." },
  { href: "/knowledge", label: "Saved answers", description: "Longer answers ansa can give: articles, documents and web pages." },
  { href: "/setup", label: "Phone, email and documents", description: "Your phone numbers, email forwarding and uploaded documents." },
];

const TEAM_LINK: SettingsLink = { href: "/team", label: "Team", description: "The people who work with you, and who handles which requests." };
const ACCOUNT_LINK: SettingsLink = { href: "/account", label: "Your account", description: "Your name, password and logins on other devices." };

// Only owners see billing: core refuses members anyway.
const BILLING_LINK: SettingsLink = { href: "/billing", label: "Billing", description: "Your subscription and payments." };

// Settings (step 44): a short list of the pages that set ansa up. Log out is
// here too, because a phone has no sidebar.
export default function SettingsPage() {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-8 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      {/* Cache Components rule: the session is only known at request time. */}
      <Suspense fallback={<PageLoading />}>
        <SettingsLists />
      </Suspense>
    </main>
  );
}

async function SettingsLists() {
  const session = await requireSessionContext("/settings");
  const billing = session.role === "owner" ? [BILLING_LINK] : [];
  const { kind } = await getSetupStateFromCore();
  if (kind === "personal") {
    return (
      <>
        <SettingsGroup title="Your assistant" links={PERSONAL_ASSISTANT_LINKS} />
        <SettingsGroup title="Account" links={[ACCOUNT_LINK, ...billing]} />
        <LogOutButton />
      </>
    );
  }
  return (
    <>
      <SettingsGroup title="Your assistant" links={ASSISTANT_LINKS} />
      <SettingsGroup title="More tools" links={MORE_LINKS} />
      <SettingsGroup title="Team and account" links={[TEAM_LINK, ACCOUNT_LINK, ...billing]} />
      <LogOutButton />
    </>
  );
}

// Here because a phone has no sidebar (where Log out sits on a laptop).
function LogOutButton() {
  return (
    <form action={logoutAction}>
      <Button type="submit" variant="outline">
        <LogOut aria-hidden />
        Log out
      </Button>
    </form>
  );
}

function SettingsGroup({ title, links }: { title: string; links: SettingsLink[] }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="flex items-center gap-4 px-4 py-3 hover:bg-accent focus-visible:bg-accent">
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="font-medium">{link.label}</span>
                <span className="text-sm text-muted-foreground">{link.description}</span>
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
