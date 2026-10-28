import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { SOCIAL_PLATFORM_LABELS } from "@/lib/social-platforms";
import type { AutopublishRuleListItem } from "@/services/publishing-pages";
import { NewRuleForm } from "./new-rule-form";
import { DisableRuleButton, EnableRuleButton } from "./rule-buttons";

type AutopublishRulesProps = {
  rules: AutopublishRuleListItem[];
  // The current plan's content pillars, for a new rule.
  pillars: string[];
  canManage: boolean;
};

// The company's auto-publish rules (step 41), on the queue page. Every post
// normally needs an owner's approval of exactly its text; a rule that is
// switched on lets a platform's drafts (of one pillar, or any) be scheduled
// without one. Rules start switched off, and only an owner switches one
// on, after a confirm saying exactly what it does.
export function AutopublishRules({ rules, pillars, canManage }: AutopublishRulesProps) {
  return (
    <section className="grid gap-3" aria-labelledby="queue-rules">
      <h2 id="queue-rules" className="text-lg font-semibold">
        Auto-publish rules
      </h2>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Every post needs an owner&apos;s approval of exactly its text, unless a rule that is switched on covers it. Then an
        owner can schedule a draft of that platform (and content pillar) without approving it, as long as it breaks none
        of the platform&apos;s rules and every claim it makes is backed by a confirmed fact. That is checked again right
        before it goes out, and switching a rule off stops its posts that haven&apos;t gone out yet. Rules start switched off.
      </p>
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rules yet: every post waits for an owner&apos;s approval.</p>
      ) : (
        <ul className="grid gap-2">
          {rules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} canManage={canManage} />
          ))}
        </ul>
      )}
      {canManage ? <NewRuleForm pillars={pillars} /> : <p className="text-sm text-muted-foreground">Only owners make rules and switch them on or off.</p>}
    </section>
  );
}

function RuleRow({ rule, canManage }: { rule: AutopublishRuleListItem; canManage: boolean }) {
  const label = `${SOCIAL_PLATFORM_LABELS[rule.platform]}, ${rule.pillar ? `pillar “${rule.pillar}”` : "every pillar"}`;
  return (
    <li className="grid gap-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={rule.enabled ? "destructive" : "outline"}>{rule.enabled ? "On" : "Off"}</Badge>
        <span className="font-medium wrap-anywhere">{label}</span>
      </div>
      <p className="text-muted-foreground">
        Made by {rule.createdByName ?? "a former teammate"} on <LocalDateTime iso={rule.createdAt.toISOString()} dateOnly />
        {rule.enabled && rule.enabledAt && (
          <>
            ; switched on by {rule.enabledByName ?? "a former teammate"} on <LocalDateTime iso={rule.enabledAt.toISOString()} />: its
            posts can go out without an approval of their own
          </>
        )}
        .
      </p>
      {canManage && (rule.enabled ? <DisableRuleButton ruleId={rule.id} ruleLabel={label} /> : <EnableRuleButton ruleId={rule.id} ruleLabel={label} />)}
    </li>
  );
}
