import Link from "next/link";
import type { ContentDraftPage } from "@/services/content-drafts";

// What the AI's text was written from (step 38), so it stays clear later
// what it was based on: the confirmed facts as they were then, the
// knowledge articles it read, and the marketing plan version. Folded away:
// the draft comes first. Nothing for a draft the AI never wrote.
export function DraftMadeFrom({ madeFrom }: { madeFrom: ContentDraftPage["madeFrom"] }) {
  if (!madeFrom) {
    return null;
  }
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">What the AI&apos;s text was written from</summary>
      <div className="mt-3 grid gap-4">
        <section className="grid gap-2" aria-label="Confirmed facts">
          <h4 className="font-medium">Confirmed facts ({madeFrom.facts.length})</h4>
          <dl className="grid gap-2">
            {madeFrom.facts.map((fact) => (
              <div key={fact.topic} className="grid gap-0.5">
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd className="whitespace-pre-wrap wrap-anywhere">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="grid gap-2" aria-label="Knowledge articles">
          <h4 className="font-medium">Knowledge articles ({madeFrom.knowledge.length})</h4>
          {madeFrom.knowledge.length === 0 ? (
            <p className="text-muted-foreground">No approved article ticked for marketing matched the topic.</p>
          ) : (
            <ul className="grid list-disc gap-1 pl-5 wrap-anywhere">
              {madeFrom.knowledge.map((article) => (
                <li key={article.articleId}>
                  {article.title === null ? (
                    <span className="text-muted-foreground">A deleted article</span>
                  ) : (
                    <Link href={`/knowledge/${article.articleId}`} className="underline">
                      {article.title}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <p>
          <span className="font-medium">Marketing plan: </span>
          {madeFrom.planVersion === null ? (
            "none."
          ) : (
            <Link href={`/cofounder/strategy/${madeFrom.planVersion}`} className="underline">
              version {madeFrom.planVersion}
            </Link>
          )}
        </p>
      </div>
    </details>
  );
}
