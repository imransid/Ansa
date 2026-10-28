import { cache, Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canEditKnowledgeArticle, canManageKnowledge } from "@/lib/knowledge/permissions";
import { getSessionContext, requireSessionContext } from "@/lib/session";
import { getKnowledgeArticleForSession, type KnowledgeArticlePage } from "@/services/knowledge";
import { ArticleForm } from "../article-form";
import { ArticleStatusActions } from "./article-status-actions";
import { ArticleSummary } from "./article-summary";

// One read per request: the tab title and the page both need the article.
const readArticle = cache(getKnowledgeArticleForSession);

// "Returns policy - Knowledge - ansa". A long title is cut here.
export async function generateMetadata({ params }: PageProps<"/knowledge/[articleId]">): Promise<Metadata> {
  const { articleId } = await params;
  const session = await getSessionContext();
  // Logged out: the page sends them to /login.
  if (!session) {
    return { title: "Article - ansa" };
  }
  const article = await readArticle(session, articleId);
  if (!article) {
    return { title: "Article not found - ansa" };
  }
  const title = article.title.length > 60 ? `${article.title.slice(0, 60).trimEnd()}...` : article.title;
  return { title: `${title} - Knowledge - ansa` };
}

export default function ArticlePage({ params }: PageProps<"/knowledge/[articleId]">) {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-6 p-6">
      {/* Cache Components rule: the session and the URL's article id are
          only known at request time, so both are read inside <Suspense>. */}
      <Suspense fallback={<p className="text-muted-foreground">Loading...</p>}>
        <ArticleContent params={params} />
      </Suspense>
    </main>
  );
}

async function ArticleContent({ params }: Pick<PageProps<"/knowledge/[articleId]">, "params">) {
  const { articleId } = await params;
  const session = await requireSessionContext(`/knowledge/${encodeURIComponent(articleId)}`);
  const article = await readArticle(session, articleId);
  // Unknown id, bad id, or another company's article: all look the same (../not-found.tsx).
  if (!article) {
    notFound();
  }
  // Hiding what would be refused is only for a tidy page: the services and
  // /db check the same rules (lib/knowledge/permissions.ts).
  const isOwner = canManageKnowledge(session.role);

  return (
    <>
      <Link href="/knowledge" className="text-sm hover:underline">
        &larr; All knowledge
      </Link>
      <ArticleSummary article={article} />
      {isOwner ? (
        <ArticleStatusActions articleId={article.id} status={article.status} revision={article.revision} title={article.title} />
      ) : (
        <p className="text-sm text-muted-foreground">Only owners can approve, archive or delete articles.</p>
      )}
      {canEditKnowledgeArticle(session.role, article.status) ? <EditSection article={article} /> : <ReadOnlyText article={article} />}
    </>
  );
}

function EditSection({ article }: { article: KnowledgeArticlePage }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">Edit</h2>
      {article.status === "approved" && (
        <p className="text-sm text-muted-foreground">
          It stays approved when you save, as approved by you: the new text is used right away.
        </p>
      )}
      <ArticleForm
        mode="edit"
        articleId={article.id}
        revision={article.revision}
        initial={{
          title: article.title,
          kind: article.kind,
          body: article.body,
          useForSupport: article.useForSupport,
          useForMarketing: article.useForMarketing,
        }}
      />
    </section>
  );
}

// For someone who may not change this article: its text, and why.
function ReadOnlyText({ article }: { article: KnowledgeArticlePage }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">Text</h2>
      <p className="text-sm text-muted-foreground">
        {article.status === "archived"
          ? "Archived articles can't be changed. An owner can restore it as a draft first."
          : "Only owners can change an approved article."}
      </p>
      <div className="rounded-lg border p-4 text-sm whitespace-pre-wrap wrap-anywhere">{article.body}</div>
    </section>
  );
}
