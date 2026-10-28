import { AppFrame } from "@/components/app-frame";

// Every page under /knowledge (the list, one article, "New article", "Import
// a web page") has the app header, with "Knowledge" marked. An article that
// isn't found: ./not-found.tsx.
export default function KnowledgeLayout({ children }: LayoutProps<"/knowledge">) {
  return <AppFrame section="knowledge">{children}</AppFrame>;
}
