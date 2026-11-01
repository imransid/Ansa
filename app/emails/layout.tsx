import { AppFrame } from "@/components/app-frame";

// Every page under /emails (received and undelivered emails) sits in the app
// frame, with Inbox marked in the sidebar.
export default function EmailsLayout({ children }: LayoutProps<"/emails">) {
  return <AppFrame section="inbox">{children}</AppFrame>;
}
