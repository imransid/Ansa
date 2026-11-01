import { AppFrame } from "@/components/app-frame";

// Every page under /settings (the list of settings pages, step 44) sits in
// the app frame, with Settings marked in the sidebar.
export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  return <AppFrame section="settings">{children}</AppFrame>;
}
