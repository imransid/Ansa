import { BrandMark } from "@/components/brand-mark";
import { PageErrorBoundary } from "@/components/page-error-boundary";

// The restaurant setup (step 45) has no sidebar: a new owner does one thing
// here, step by step, and leaves for Home at the end. Errors are caught
// below ansa's mark, so it stays when a step fails.
export default function WelcomeLayout({ children }: LayoutProps<"/welcome">) {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <header className="mx-auto w-full max-w-2xl px-6 pt-8">
        <BrandMark />
      </header>
      <PageErrorBoundary>{children}</PageErrorBoundary>
    </div>
  );
}
