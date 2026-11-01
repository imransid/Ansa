import { AppFrame } from "@/components/app-frame";

// Every page under /account (your own account) sits in the app frame, with
// Settings marked in the sidebar.
export default function AccountLayout({ children }: LayoutProps<"/account">) {
  return <AppFrame section="settings">{children}</AppFrame>;
}
