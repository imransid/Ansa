import { AppFrame } from "@/components/app-frame";

// Every page under /tickets (one ticket, "New ticket") sits in the app frame,
// with Inbox marked in the sidebar. A ticket that isn't found: ./not-found.tsx.
export default function TicketsLayout({ children }: LayoutProps<"/tickets">) {
  return <AppFrame section="inbox">{children}</AppFrame>;
}
