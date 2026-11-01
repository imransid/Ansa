import { AppFrame } from "@/components/app-frame";

// Every page under /dashboard (Home: the business overview) sits in the app
// frame, with Home marked in the sidebar.
export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return <AppFrame section="home">{children}</AppFrame>;
}
