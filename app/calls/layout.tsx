import { AppFrame } from "@/components/app-frame";

// Every page under /calls (the list, one call) sits in the app frame, with
// Inbox marked in the sidebar. A call that isn't found: ./not-found.tsx.
export default function CallsLayout({ children }: LayoutProps<"/calls">) {
  return <AppFrame section="inbox">{children}</AppFrame>;
}
