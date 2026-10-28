import Form from "next/form";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SearchBoxProps = {
  // The list's own path, e.g. "/dashboard". The search goes there as ?q=.
  action: string;
  label: string;
  placeholder: string;
  // The search on screen now (shown in the box), or null.
  search: string | null;
  // Other values the search sends along, such as the view to search in.
  hiddenFields: Record<string, string>;
  // Where "Clear search" leads while a search is on.
  clearHref: string;
};

// A plain GET search for a list: it only changes the URL (?q=...), so the
// result can be bookmarked, shared and paged like any other list. next/form
// moves there without reloading the whole page.
export function SearchBox({ action, label, placeholder, search, hiddenFields, clearHref }: SearchBoxProps) {
  return (
    <Form action={action} role="search" className="flex flex-wrap items-center gap-2">
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Input
        // A new key when the search changes, so the box shows the current one
        // after "Clear search" or a link (it is not a controlled input).
        key={search ?? ""}
        type="search"
        name="q"
        defaultValue={search ?? ""}
        maxLength={100}
        placeholder={placeholder}
        aria-label={label}
        className="w-80 max-w-full"
      />
      <Button type="submit" variant="outline">
        Search
      </Button>
      {search && (
        <Link href={clearHref} className="text-sm underline">
          Clear search
        </Link>
      )}
    </Form>
  );
}
