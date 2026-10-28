import { AppFrame } from "@/components/app-frame";

// Every page under /calls (the list, one call) has the app header, with
// "Calls" marked. A call that isn't found: ./not-found.tsx.
export default function CallsLayout({ children }: LayoutProps<"/calls">) {
  return <AppFrame section="calls">{children}</AppFrame>;
}
