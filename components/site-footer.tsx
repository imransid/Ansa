import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";

export function SiteFooter() {
  return (
    <footer className="border-t bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground">
        <div className="flex items-center gap-4">
          <BrandMark />
          <span>Your AI stand-in when you can&rsquo;t answer.</span>
        </div>
        <nav aria-label="Website" className="flex gap-5">
          <Link href="/pricing" className="hover:text-foreground hover:underline">
            Pricing
          </Link>
          <Link href="/privacy" className="hover:text-foreground hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground hover:underline">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
