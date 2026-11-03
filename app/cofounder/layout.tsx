import { AppFrame } from "@/components/app-frame";

// Every page under /cofounder sits in the app frame, under Settings, which
// links Social media posts (the studio) and the accounts for businesses; the
// studio links the media library, the scheduled posts and the Marketing
// planner (/cofounder), which lists every page (step 58).
export default function CoFounderLayout({ children }: LayoutProps<"/cofounder">) {
  return <AppFrame section="settings">{children}</AppFrame>;
}
