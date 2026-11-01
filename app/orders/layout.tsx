import { AppFrame } from "@/components/app-frame";

// The Orders page (step 52) sits in the app frame, with Orders marked in the
// sidebar (shown there for a business that takes orders).
export default function OrdersLayout({ children }: LayoutProps<"/orders">) {
  return <AppFrame section="orders">{children}</AppFrame>;
}
