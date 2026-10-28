import { AppFrame } from "@/components/app-frame";

// Every page under /billing (billing) has the app header, with
// "Billing" marked.
export default function BillingLayout({ children }: LayoutProps<"/billing">) {
  return <AppFrame section="billing">{children}</AppFrame>;
}
