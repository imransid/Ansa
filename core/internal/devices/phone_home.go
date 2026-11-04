package devices

import (
	"context"
	"sort"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/inbox"
	"ansa/core/internal/tenant"
)

// How many lines of what ansa did the app shows (as the web Home).
const activityShown = 6

// PhoneHome is the app's main screen: the status, how many conversations
// need a person (the web Home's "Needs you", by its own condition), and
// what ansa did.
type PhoneHome struct {
	Status   Status         `json:"status"`
	NeedsYou int            `json:"needsYou"`
	Activity []ActivityLine `json:"activity"`
}

// ActivityLine is one line for people: when, what ("Answered a message"),
// and who it was about ("Nabil"; "" for the phones' own lines).
type ActivityLine struct {
	At   string `json:"at"`
	Text string `json:"text"`
	Who  string `json:"who"`
	// For sorting the two kinds of lines together; not sent.
	at time.Time
}

// ReadPhoneHome reads the app's main screen at this moment.
func ReadPhoneHome(ctx context.Context, pool *database.Pool, company tenant.CompanyID, now time.Time) (PhoneHome, error) {
	status, err := ReadStatus(ctx, pool, company, now)
	if err != nil {
		return PhoneHome{}, err
	}
	counts, err := inbox.Counts(ctx, pool, company)
	if err != nil {
		return PhoneHome{}, err
	}
	lines, err := readActivity(ctx, pool, company)
	if err != nil {
		return PhoneHome{}, err
	}
	return PhoneHome{Status: status, NeedsYou: counts[inbox.ViewNeedsYou], Activity: lines}, nil
}

// readActivity is the web Home's "What ansa did" (its own read, worded as
// Home words it) with the phones' own lines among them, newest first.
func readActivity(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]ActivityLine, error) {
	ansaLines, err := inbox.ListActivity(ctx, pool, company, "", activityShown)
	if err != nil {
		return nil, err
	}
	lines := []ActivityLine{}
	for _, line := range ansaLines {
		if words := activityWords(line.Action); words != "" {
			lines = append(lines, ActivityLine{at: line.CreatedAt, Text: words, Who: customerLabel(line.ContactName, line.Channel)})
		}
	}
	phoneLines, err := readPresenceChanges(ctx, pool, company)
	if err != nil {
		return nil, err
	}
	lines = append(lines, phoneLines...)
	sort.SliceStable(lines, func(i, j int) bool { return lines[i].at.After(lines[j].at) })
	lines = lines[:min(len(lines), activityShown)]
	for i := range lines {
		lines[i].At = rfc3339(&lines[i].at)
	}
	return lines, nil
}

// readPresenceChanges is the newest of the phones' own lines.
func readPresenceChanges(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]ActivityLine, error) {
	const statement = `
		SELECT change, created_at FROM phone_presence_changes WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2`
	rows, err := pool.Query(ctx, statement, company.String(), activityShown)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	lines := []ActivityLine{}
	for rows.Next() {
		var change string
		var at time.Time
		if err := rows.Scan(&change, &at); err != nil {
			return nil, err
		}
		lines = append(lines, ActivityLine{at: at, Text: presenceText[change]})
	}
	return lines, rows.Err()
}
