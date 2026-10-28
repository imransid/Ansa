import { AppFrame } from "@/components/app-frame";

// Every page under /account (your own account) has the app header, with
// "Account" marked.
export default function AccountLayout({ children }: LayoutProps<"/account">) {
  return <AppFrame section="account">{children}</AppFrame>;
}
