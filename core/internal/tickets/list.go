package tickets

import (
	"context"
	"regexp"
	"strconv"
	"strings"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// The list's views: "mine" is always the session's own person ($2, declared
// once in a WITH so its type is known whichever view a statement uses).
// Pieces of a WHERE (only the requests table has these columns in the
// statements that use them, which name the company themselves).
var views = map[string]string{
	"open":       `status = 'open'`,
	"mine":       `status = 'open' AND assigned_to_user_id = (SELECT id FROM viewer)`,
	"unassigned": `status = 'open' AND assigned_to_user_id IS NULL`,
	"solved":     `status = 'solved'`,
	"all":        `true`,
}

// IsView reports whether view is one of the list's.
func IsView(view string) bool {
	_, known := views[view]
	return known
}

// Line is one request in the list.
type Line struct {
	ID            string    `json:"id"`
	Number        int       `json:"number"`
	Subject       string    `json:"subject"`
	Status        string    `json:"status"`
	Channel       string    `json:"channel"`
	CustomerName  *string   `json:"customerName"`
	CustomerEmail *string   `json:"customerEmail"`
	CustomerPhone *string   `json:"customerPhone"`
	Category      *string   `json:"category"`
	CreatedAt     time.Time `json:"createdAt"`
	AssigneeName  *string   `json:"assigneeName"`
	AssigneeEmail *string   `json:"assigneeEmail"`
}

// search is a list's search as SQL over parameters $3 (the ILIKE pattern),
// $4 (a phone number's digits, "" = none) and $5 (a ticket number, 0 = none):
// the text anywhere in the subject, the customer's name, email or phone, or
// the address the original email came from; a phone number however written;
// "#57" or "57" finds request 57. Every value is a parameter, never SQL text.
const search = `($3::text = '' OR tickets.subject ILIKE $3 OR tickets.customer_name ILIKE $3 OR tickets.customer_email ILIKE $3
	OR tickets.customer_phone ILIKE $3
	OR tickets.id IN (SELECT ticket_id FROM inbound_emails WHERE inbound_emails.company_id = $1 AND ticket_id IS NOT NULL
		AND (from_address ILIKE $3 OR reply_to_address ILIKE $3))
	OR ($4::text <> '' AND regexp_replace(tickets.customer_phone, '[^0-9]', '', 'g') LIKE '%' || $4::text || '%')
	OR ($5::int > 0 AND tickets.ticket_number = $5::int))`

var phoneText = regexp.MustCompile(`^[\d\s+().-]+$`)
var ticketNumberText = regexp.MustCompile(`^#?(\d{1,10})$`)

// searchArguments turns what someone typed into the search's three values.
func searchArguments(q string) (pattern, digits string, number int) {
	q = strings.TrimSpace(q)
	if q == "" {
		return "", "", 0
	}
	pattern = "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q) + "%"
	if phoneText.MatchString(q) {
		if only := regexp.MustCompile(`\D`).ReplaceAllString(q, ""); len(only) >= 3 {
			digits = only
		}
	}
	if match := ticketNumberText.FindStringSubmatch(q); match != nil {
		if n, err := strconv.Atoi(match[1]); err == nil && n >= 1 && n <= 2_147_483_647 {
			number = n
		}
	}
	return pattern, digits, number
}

// List is one page (50) of one view, with a search, newest first.
func List(ctx context.Context, pool *database.Pool, company tenant.CompanyID, viewerUserID, view, q string, page int) ([]Line, error) {
	pattern, digits, number := searchArguments(q)
	// The view's condition is fixed text from `views`, never input.
	statement := `
		WITH viewer AS (SELECT $2::text AS id)
		SELECT tickets.id, tickets.ticket_number, tickets.subject, tickets.status, tickets.channel, tickets.customer_name,
			tickets.customer_email, tickets.customer_phone, tickets.category, tickets.created_at, assignee.name, assignee.email
		FROM tickets
		LEFT JOIN users AS assignee ON assignee.id = tickets.assigned_to_user_id AND assignee.company_id = tickets.company_id
		WHERE tickets.company_id = $1 AND ` + views[view] + ` AND ` + search + `
		ORDER BY tickets.ticket_number DESC LIMIT 50 OFFSET $6`
	offset := (min(max(page, 1), 10_000) - 1) * 50
	rows, err := pool.Query(ctx, statement, company.String(), viewerUserID, pattern, digits, number, offset)
	if err != nil {
		return nil, err
	}
	lines := []Line{}
	for rows.Next() {
		var l Line
		if err := rows.Scan(&l.ID, &l.Number, &l.Subject, &l.Status, &l.Channel, &l.CustomerName, &l.CustomerEmail, &l.CustomerPhone,
			&l.Category, &l.CreatedAt, &l.AssigneeName, &l.AssigneeEmail); err != nil {
			return nil, err
		}
		lines = append(lines, l)
	}
	return lines, rows.Err()
}

// CountPerView counts every view at once with the search: each count uses
// its view's own condition, so a link's number matches the list it opens.
func CountPerView(ctx context.Context, pool *database.Pool, company tenant.CompanyID, viewerUserID, q string) (map[string]int, error) {
	pattern, digits, number := searchArguments(q)
	statement := `
		WITH viewer AS (SELECT $2::text AS id)
		SELECT count(*) FILTER (WHERE ` + views["open"] + `), count(*) FILTER (WHERE ` + views["mine"] + `),
			count(*) FILTER (WHERE ` + views["unassigned"] + `), count(*) FILTER (WHERE ` + views["solved"] + `), count(*)
		FROM tickets WHERE tickets.company_id = $1 AND ` + search
	var open, mine, unassigned, solved, all int
	err := pool.QueryRow(ctx, statement, company.String(), viewerUserID, pattern, digits, number).Scan(&open, &mine, &unassigned, &solved, &all)
	return map[string]int{"open": open, "mine": mine, "unassigned": unassigned, "solved": solved, "all": all}, err
}
