import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { SetupStatus } from "@/services/setup";

// The "what's left to set up" list at the top of the Setup page.
export function Checklist({ setup }: { setup: SetupStatus }) {
  const items = [
    { label: "Reply-to address for customer emails", done: setup.replyToEmail !== null },
    { label: "At least one phone number", done: setup.phoneLines.length > 0 },
    { label: "At least one support email address", done: setup.inboundAddresses.length > 0 },
    { label: "Categories, so tickets reach the right person", done: setup.activeCategoryCount > 0, href: "/team" },
    { label: "Invite your team", done: setup.memberCount > 1, href: "/team" },
    { label: "Upload your documents", done: setup.documentCount > 0 },
  ];

  return (
    <ul className="grid max-w-xl gap-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center justify-between gap-4 rounded-md border px-3 py-2 text-sm">
          {item.href ? (
            <Link href={item.href} className="hover:underline">
              {item.label}
            </Link>
          ) : (
            <span>{item.label}</span>
          )}
          <Badge variant={item.done ? "default" : "outline"}>{item.done ? "done" : "to do"}</Badge>
        </li>
      ))}
    </ul>
  );
}
