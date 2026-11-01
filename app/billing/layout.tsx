import { AppFrame } from "@/components/app-frame";

// Every page under /billing (billing) sits in the app frame, with Settings
// marked in the sidebar.
export default function BillingLayout({ children }: LayoutProps<"/billing">) {
  return <AppFrame section="settings">{children}</AppFrame>;
}
