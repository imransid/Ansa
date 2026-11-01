import { AppFrame } from "@/components/app-frame";

// Every page under /knowledge (the list, one article, "New article", "Import
// a web page") sits in the app frame, with Settings marked in the sidebar. An
// article that isn't found: ./not-found.tsx.
export default function KnowledgeLayout({ children }: LayoutProps<"/knowledge">) {
  return <AppFrame section="settings">{children}</AppFrame>;
}
