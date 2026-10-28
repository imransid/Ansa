import { AppFrame } from "@/components/app-frame";

// Every page under /tickets (one ticket, "New ticket") has the app header,
// with "Tickets" marked. A ticket that isn't found: ./not-found.tsx.
export default function TicketsLayout({ children }: LayoutProps<"/tickets">) {
  return <AppFrame section="tickets">{children}</AppFrame>;
}
