import type { ReactNode } from "react";
import { site } from "@/lib/site";

type LegalPageProps = {
  title: string;
  children: ReactNode;
};

// The frame of the privacy policy and the terms: title, date, draft notice.
export function LegalPage({ title, children }: LegalPageProps) {
  return (
    <article className="mx-auto grid w-full max-w-3xl gap-6 px-6 py-12 text-sm leading-6 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">Last updated: {site.legalPagesUpdatedOn}</p>
      </header>
      {!site.legalPagesReviewed && (
        <p role="note" className="rounded-md border border-dashed px-4 py-3">
          This is a draft. It has not been reviewed by a lawyer yet and may change before launch.
        </p>
      )}
      {children}
    </article>
  );
}
