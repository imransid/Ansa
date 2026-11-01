import { AppFrame } from "@/components/app-frame";

// Every page under /team (the team) sits in the app frame, with Settings
// marked in the sidebar.
export default function TeamLayout({ children }: LayoutProps<"/team">) {
  return <AppFrame section="settings">{children}</AppFrame>;
}
