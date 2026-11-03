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
**Read my menu (`core/internal/menureading`, `brain/brain/menu/reading.py`):**
`POST /api/v1/menu/read {"text"}` or `{"fileName", "data": base64}` (owners;
20 an hour per business; a body of up to 6 MB on this endpoint only, and a
longer answer time: the AI may take two minutes). A file is known by its own
first bytes, never its name: a photo (JPEG, PNG, WebP, GIF) or a PDF goes to
the model as itself (no PDF parser runs on our servers, and a scanned PDF
reads too); a Word file (a zip named .docx) has only its text part unpacked
by Go's standard library, never more than 50 MB whatever its headers claim;
pasted text up to 20,000 characters. The brain answers rows; core reads each
row itself (cut to the menu's limits, a name, a price `money.ParsePrice` can
read; at most 150; how many were left out). Without an AI key, a
development brain with Claude Code on the computer reads it there
(`brain/brain/free_ai.py`): text as it is, a photo as itself (one
stream-json message), a PDF as its own text (the brain's PDF reader: a
scanned one has none, so nothing to read); without Claude Code either, the
development brain answers a labelled sample, which the page shows under its
banner and never offers to add ("Looks right" is only for a menu ansa read);
production says reading isn't available. NOTHING is saved by reading:
"Looks right" adds the checked list.
**Tests:** `menureading_test.go` (a Word file's text; a bomb stops at its
cap; files known by their bytes, a fake .jpg and a zip not named .docx
refused; core prices every row itself and cuts long names);
`brain/tests/test_menu.py` (text escaped in `<menu>`; a photo and a PDF sent
as themselves; rows read strictly; ansa's own key; the sample only in
development; without a key, Claude Code reads a PDF's own text and a photo
as itself); `api/menu_test.go` (a fake photo refused; reading saves
nothing); `pnpm check:screens` (the sample is never offered as the owner's).
