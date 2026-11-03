import type { ReactNode } from "react";
import Link from "next/link";
import { buildListUrl } from "@/lib/pagination";
import type { KnowledgeListQuery, KnowledgeStatusFilter } from "@/lib/validation/list-queries";

const EMPTY_STATUS_TEXT: Record<KnowledgeStatusFilter, string> = {
  all: "No articles yet.",
  draft: "No drafts waiting for approval.",
  approved: "No approved articles yet: none is used until an owner approves it.",
  archived: "No archived articles.",
};

type KnowledgeListEmptyProps = {
  query: KnowledgeListQuery;
  page: number;
  // How many articles the company has, whatever the search.
  totalArticles: number;
  isOwner: boolean;
  // One person's account (step 50): no team, no customers.
  personal: boolean;
};

// Shown instead of the article table when the list on screen has no rows.
// A company without any article first learns what knowledge is for.
export function KnowledgeListEmpty({ query, page, totalArticles, isOwner, personal }: KnowledgeListEmptyProps) {
  if (totalArticles === 0) {
    return personal ? <FirstSavedAnswer /> : <FirstArticle isOwner={isOwner} />;
  }
  if (page > 1) {
    return (
      <EmptyBox>
        Nothing on this page.{" "}
        <Link href={buildListUrl("/knowledge", { status: query.status, q: query.search })} className="underline">
          Go to the first page
        </Link>
      </EmptyBox>
    );
  }
  if (query.search) {
    return (
      <EmptyBox>
        No article titles {query.status === "all" ? "" : "with this status "}match &ldquo;{query.search}&rdquo;.{" "}
        <Link href={buildListUrl("/knowledge", { status: query.status })} className="underline">
          Clear search
        </Link>
      </EmptyBox>
    );
  }
  return <EmptyBox>{EMPTY_STATUS_TEXT[query.status]}</EmptyBox>;
}

function FirstArticle({ isOwner }: { isOwner: boolean }) {
  return (
    <div className="grid gap-3 rounded-lg border p-6 text-sm">
      <p className="font-medium">Teach the AI what your team knows.</p>
      <p className="text-muted-foreground">
        Write down the answers your team gives again and again: opening hours, prices, how returns work, how to fix
        the common problems. Once an owner approves an article, your team sees it on every request it matches, and
        it is ready for the AI.
      </p>
      <ul className="grid gap-1">
        <li>
          <Link href="/knowledge/new" className="underline">
            New article
          </Link>
          : write one yourself, or use &ldquo;Save as knowledge&rdquo; on a solved request.
        </li>
        <li>
          {isOwner ? (
            <Link href="/knowledge/import" className="underline">
              Import a web page
            </Link>
          ) : (
            "Import a web page"
          )}
          : your help center or FAQ page{isOwner ? "" : " (owners)"}.
        </li>
        <li>
          <Link href="/setup#documents" className="underline">
            Documents on the Setup page
          </Link>
          : add an uploaded PDF, Word, text or CSV file to knowledge{isOwner ? "" : " (owners)"}.
        </li>
      </ul>
    </div>
  );
}

// A person's first saved answer: what ansa may tell people about them.
function FirstSavedAnswer() {
  return (
    <div className="grid gap-3 rounded-lg border p-6 text-sm">
      <p className="font-medium">Teach ansa your usual answers.</p>
      <p className="text-muted-foreground">
        Write down what people ask you again and again: what you do, your rates, when you&apos;re free, how to reach
        you. Once you approve one, ansa may give it for you.
      </p>
      <ul className="grid gap-1">
        <li>
          <Link href="/knowledge/new" className="underline">
            New article
          </Link>
          : write one yourself.
        </li>
        <li>
          <Link href="/knowledge/import" className="underline">
            Import a web page
          </Link>
          : your website or a page about your work.
        </li>
      </ul>
    </div>
  );
}

function EmptyBox({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border p-6 text-center text-muted-foreground">{children}</p>;
}
