import { AppFrame } from "@/components/app-frame";

// Every page under /inbox (the ticket list, step 44) sits in the app frame,
// with Inbox marked in the sidebar.
export default function InboxLayout({ children }: LayoutProps<"/inbox">) {
  return <AppFrame section="inbox">{children}</AppFrame>;
}
