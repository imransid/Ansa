// Who may change the restaurant's setup and its assistant (step 45). One
// place, read by the services and by /db (with the role read again, locked,
// inside the transaction that writes), and by the pages only to hide what
// would be refused anyway.

type Role = "owner" | "member";

// The setup decides what the assistant tells customers and how it answers
// them, so only owners change it; members read it.
export function canManageRestaurant(role: Role): boolean {
  return role === "owner";
}

// Adding, changing, moving and deleting dishes on the menu (step 46): the
// prices the assistant quotes, so owners only.
export function canEditMenu(role: Role): boolean {
  return role === "owner";
}

// "Not available today": whoever is working knows first when a dish runs
// out, so everyone in the company may switch it.
export function canMarkMenuAvailability(role: Role): boolean {
  return role === "owner" || role === "member";
}
