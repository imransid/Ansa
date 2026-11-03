"use client";

import { useState, useTransition } from "react";
import { addCheckedMenuReadingAction, readMenuAction } from "@/app/actions/menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MENU_CATEGORY_MAX_LENGTH, MENU_DESCRIPTION_MAX_LENGTH, MENU_NAME_MAX_LENGTH, MENU_PRICE_TEXT_MAX_LENGTH, MENU_TEXT_MAX_LENGTH, priceForEditing } from "@/lib/menu";

// One dish of the list being checked, as its boxes hold it.
type Row = { key: number; category: string; name: string; description: string; price: string };

// "Read my menu" (step 46): first a photo, a file or pasted text; then the
// dishes ansa read, each editable or removable; nothing is saved until
// "Looks right". WHY the actions are called from onSubmit in a transition:
// the list lives in this component's state, and React empties a form after
// a <form action> runs.
export function MenuReader({ currency }: { currency: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [notes, setNotes] = useState<{ dropped: number; standIn: boolean }>({ dropped: 0, standIn: false });
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function read(form: HTMLFormElement) {
    const data = new FormData(form);
    setMessage(null);
    startTransition(async () => {
      const outcome = await readMenuAction(data);
      if (!outcome.ok) {
        setMessage(outcome.message);
        return;
      }
      setNotes({ dropped: outcome.dropped, standIn: outcome.standIn });
      setRows(
        outcome.items.map((item, index) => ({
          key: index,
          category: item.category,
          name: item.name,
          description: item.description,
          price: priceForEditing(item.priceCents, currency),
        })),
      );
    });
  }

  function save(list: Row[]) {
    setMessage(null);
    startTransition(async () => {
      const errors = await addCheckedMenuReadingAction(list.map(({ category, name, description, price }) => ({ category, name, description, price })));
      setMessage(errors.message ?? "Check the list and try again.");
    });
  }

  if (!rows) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          read(event.currentTarget);
        }}
        className="grid gap-5"
      >
        <div className="grid gap-2">
          <Label htmlFor="menu-file">A photo of your menu, or a PDF or Word file</Label>
          <Input id="menu-file" name="file" type="file" accept="image/jpeg,image/png,image/webp,.pdf,.docx,.txt" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="menu-text">Or paste its text</Label>
          <Textarea id="menu-text" name="text" rows={6} maxLength={MENU_TEXT_MAX_LENGTH} />
        </div>
        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
        <Button type="submit" size="lg" disabled={isPending} className="justify-self-start">
          {isPending ? "Reading your menu, this can take a minute..." : "Read my menu"}
        </Button>
      </form>
    );
  }

  // WHY the development sample (no AI could read the menu) is only shown:
  // added, it would pose as the owner's own dishes and prices.
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!notes.standIn) {
          save(rows);
        }
      }}
      className="grid gap-5"
    >
      {notes.standIn && (
        <p className="rounded-xl bg-attention-surface px-4 py-3 text-sm">
          Development stand-in: this is a sample menu, not yours, so it can&apos;t be added. Your menu wasn&apos;t read: there is no Anthropic API
          key, and no Claude Code on this computer.
        </p>
      )}
      {!notes.standIn && (
        <p className="text-sm text-muted-foreground">
          ansa read {rows.length === 1 ? "1 dish" : `${rows.length} dishes`}. Check each one against your menu: nothing is saved until you press
          &ldquo;Looks right&rdquo;.
          {notes.dropped > 0 && ` ${notes.dropped === 1 ? "1 line" : `${notes.dropped} lines`} without a clear name or price were left out.`}
        </p>
      )}
      <ol className="grid divide-y border-y">
        {rows.map((row, index) => (
          <li key={row.key} className="grid gap-2 py-4 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
            <RowBox label="Dish" value={row.name} maxLength={MENU_NAME_MAX_LENGTH} onChange={(name) => setRows(update(rows, index, { name }))} />
            <RowBox label="Category" value={row.category} maxLength={MENU_CATEGORY_MAX_LENGTH} onChange={(category) => setRows(update(rows, index, { category }))} />
            <RowBox label={`Price (${currency})`} value={row.price} maxLength={MENU_PRICE_TEXT_MAX_LENGTH} onChange={(price) => setRows(update(rows, index, { price }))} />
            <Button type="button" variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, other) => other !== index))} aria-label={`Leave out ${row.name}`}>
              Leave out
            </Button>
            <div className="sm:col-span-3">
              <RowBox label="Description" value={row.description} maxLength={MENU_DESCRIPTION_MAX_LENGTH} onChange={(description) => setRows(update(rows, index, { description }))} />
            </div>
          </li>
        ))}
      </ol>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {!notes.standIn && (
          <Button type="submit" size="lg" disabled={isPending || rows.length === 0}>
            {isPending ? "Adding..." : `Looks right, add ${rows.length === 1 ? "1 dish" : `${rows.length} dishes`}`}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={() => setRows(null)} disabled={isPending}>
          Start again
        </Button>
      </div>
    </form>
  );
}

function update(rows: Row[], index: number, change: Partial<Row>): Row[] {
  return rows.map((row, other) => (other === index ? { ...row, ...change } : row));
}

// One box of a dish in the list, labelled for screen readers by what it holds.
function RowBox({ label, value, maxLength, onChange }: { label: string; value: string; maxLength: number; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
      {label}
      <Input value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} className="text-sm font-medium text-foreground" />
    </label>
  );
}
