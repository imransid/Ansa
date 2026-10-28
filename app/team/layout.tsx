import { AppFrame } from "@/components/app-frame";

// Every page under /team (the team) has the app header, with
// "Team" marked.
export default function TeamLayout({ children }: LayoutProps<"/team">) {
  return <AppFrame section="team">{children}</AppFrame>;
}
