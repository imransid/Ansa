# menu (core/internal/menu)

**What:** a business's menu (the old `services/menu.ts`, `db/menu.ts`).
Owners add, change, move (within its category) and delete dishes; anyone in
the company marks a dish "Not available today" (whoever is working knows
first). Every write reads the person again; adding and moving take the
company row lock first (the 500-dish cap, the positions).
**Rules:** a category up to 60, a name 1-120, a description up to 500 (one
plain line each); a price typed as text and read in the menu's currency
(`money.ParsePrice`: "9,5" = 9.50, whole smallest units). No menu before a
currency (setup's orders step). "Not available today" lasts until the
business's next midnight in its own time zone (UTC before setup chose one;
Go's own rules handle a clock change that night) and then ends by itself.
**API:** `GET /api/v1/menu` ({items, currency, canEdit}); owners:
`POST /api/v1/menu/items` (a dish), `.../items/{id}` (change),
`.../items/{id}/delete`, `.../items/{id}/move {"direction": "up"|"down"}`,
`/api/v1/menu/reading/confirm {"items": [...]}` ("Looks right": 1-150 dishes,
each checked again, all or none, a problem naming its dish: "Dish 2 (Wine):
write a price like 9.50."); anyone: `.../items/{id}/availability {"available": bool}`.
120 menu changes per 10 minutes per person.
**Tests:** `api/menu_test.go` (live database): no dish before a currency;
problems by field; "9,5" = 950 cents; moving up; not available today; a
reading names its dish and adds nothing; deleting twice = 404; the next
midnight in Rome.
**Still on the old backend:** reading a menu from a photo, a file or pasted
text (the brain's next endpoint).
