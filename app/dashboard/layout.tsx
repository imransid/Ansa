import { AppFrame } from "@/components/app-frame";

// Every page under /dashboard (the ticket list) has the app header, with
// "Tickets" marked.
export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return <AppFrame section="tickets">{children}</AppFrame>;
}
