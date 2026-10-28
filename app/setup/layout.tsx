import { AppFrame } from "@/components/app-frame";

// Every page under /setup (company setup) has the app header, with
// "Setup" marked.
export default function SetupLayout({ children }: LayoutProps<"/setup">) {
  return <AppFrame section="setup">{children}</AppFrame>;
}
