import { AppFrame } from "@/components/app-frame";

// Every page under /setup (company setup) sits in the app frame, with
// Settings marked in the sidebar.
export default function SetupLayout({ children }: LayoutProps<"/setup">) {
  return <AppFrame section="settings">{children}</AppFrame>;
}
