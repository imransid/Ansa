import { AppFrame } from "@/components/app-frame";

// Every page under /emails (received and undelivered emails) has the app header, with
// "Emails" marked.
export default function EmailsLayout({ children }: LayoutProps<"/emails">) {
  return <AppFrame section="emails">{children}</AppFrame>;
}
