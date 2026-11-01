// Package teammates is the Team page (the old db/team-members.ts,
// db/invites.ts, db/categories.ts, db/user-categories.ts,
// db/teammate-access.ts, db/unconfirmed-accounts.ts and their services):
// who is on the team, invites, roles, removing someone, and the categories
// routing follows. Only owners invite, remove and change roles, never their
// own; each person ticks their own categories, owners anyone's. Every team
// change takes the company row lock FIRST, so two owners can't remove or
// demote each other at once and a company always keeps an active owner.
// Joining through an invite stays with signup (Better Auth) until login moves.
package teammates

import (
	"context"
	"sort"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Person is someone on the team, or removed from it.
type Person struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Email     string     `json:"email"`
	Role      string     `json:"role"`
	Confirmed bool       `json:"confirmed"`
	RemovedAt *time.Time `json:"removedAt"`
	// The active categories they handle.
	CategoryIDs []string `json:"categoryIds"`
}

// Invite is a pending invite (not accepted, revoked or expired).
type Invite struct {
	ID        string    `json:"id"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// Category is one of the company's categories.
type Category struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Archived bool   `json:"archived"`
}

// Team is what the Team page shows: everyone (oldest first), the removed
// most recently removed first, pending invites (owners only) and categories.
type Team struct {
	Members    []Person   `json:"members"`
	Removed    []Person   `json:"removed"`
	Invites    []Invite   `json:"invites"`
	Categories []Category `json:"categories"`
}

// ReadTeam reads one company's team. Pending invites only when withInvites
// (owners): members never see them.
func ReadTeam(ctx context.Context, pool *database.Pool, company tenant.CompanyID, withInvites bool) (Team, error) {
	team := Team{Members: []Person{}, Removed: []Person{}, Invites: []Invite{}, Categories: []Category{}}
	const people = `
		SELECT users.id, users.name, users.email, users.role, users.email_verified, users.deactivated_at,
			COALESCE(array_agg(links.category_id::text ORDER BY categories.name) FILTER (WHERE categories.id IS NOT NULL), '{}')
		FROM users
		LEFT JOIN user_categories AS links ON links.company_id = users.company_id AND links.user_id = users.id
		LEFT JOIN categories ON categories.company_id = links.company_id AND categories.id = links.category_id AND categories.archived_at IS NULL
		WHERE users.company_id = $1
		GROUP BY users.id
		ORDER BY users.created_at`
	rows, err := pool.Query(ctx, people, company.String())
	if err != nil {
		return Team{}, err
	}
	for rows.Next() {
		var p Person
		if err := rows.Scan(&p.ID, &p.Name, &p.Email, &p.Role, &p.Confirmed, &p.RemovedAt, &p.CategoryIDs); err != nil {
			rows.Close()
			return Team{}, err
		}
		if p.RemovedAt == nil {
			team.Members = append(team.Members, p)
		} else {
			team.Removed = append(team.Removed, p)
		}
	}
	if err := rows.Err(); err != nil {
		return Team{}, err
	}
	sortRemoved(team.Removed)
	if team.Categories, err = readCategories(ctx, pool, company); err != nil {
		return Team{}, err
	}
	if withInvites {
		team.Invites, err = pendingInvites(ctx, pool, company)
	}
	return team, err
}

// sortRemoved puts the most recently removed first.
func sortRemoved(removed []Person) {
	sort.SliceStable(removed, func(a, b int) bool { return removed[a].RemovedAt.After(*removed[b].RemovedAt) })
}

// readCategories is the company's categories, active first, then by name.
func readCategories(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]Category, error) {
	rows, err := pool.Query(ctx, `SELECT id, name, archived_at IS NOT NULL FROM categories WHERE company_id = $1 ORDER BY archived_at IS NOT NULL, name`, company.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	categories := []Category{}
	for rows.Next() {
		var c Category
		if err := rows.Scan(&c.ID, &c.Name, &c.Archived); err != nil {
			return nil, err
		}
		categories = append(categories, c)
	}
	return categories, rows.Err()
}
