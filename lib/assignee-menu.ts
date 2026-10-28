// The ticket page's "Assigned to" menu (step 32): names are free text, and
// two teammates can share one.

// One choice in the menu: the person's id and what the menu shows.
export type AssigneeOption = { id: string; label: string };

type Person = {
  id: string;
  name: string;
  // Null when we don't show one (someone who can no longer take tickets).
  email: string | null;
};

// The menu's labels: the name, plus the email when someone else in the menu
// has the same name (ignoring letter case and spaces at the ends). Picking the
// wrong "Alex" would give the ticket, and the "a ticket is yours" email, to
// the other one.
export function labelAssigneeOptions(people: Person[]): AssigneeOption[] {
  const peoplePerName = new Map<string, number>();
  for (const person of people) {
    const name = comparableName(person.name);
    peoplePerName.set(name, (peoplePerName.get(name) ?? 0) + 1);
  }
  return people.map((person) => {
    const nameIsShared = (peoplePerName.get(comparableName(person.name)) ?? 0) > 1;
    const label = nameIsShared && person.email ? `${person.name} (${person.email})` : person.name;
    return { id: person.id, label };
  });
}

function comparableName(name: string): string {
  return name.trim().toLocaleLowerCase();
}
