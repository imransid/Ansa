import { AppFrame } from "@/components/app-frame";

// Every page under /cofounder sits in the app frame, under Settings: the
// social media posts (studio, media library, accounts) are listed there for
// businesses, and the older pages (Overview, Interview, Profile, Strategy,
// Calendar, Queue, Analytics) under "Older pages" until step 58.
export default function CoFounderLayout({ children }: LayoutProps<"/cofounder">) {
  return <AppFrame section="settings">{children}</AppFrame>;
}
