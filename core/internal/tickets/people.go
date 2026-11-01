package tickets

import (
	"context"
	"sort"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// The ticket side of team changes (the old db/teammate-access.ts,
// db/unconfirmed-accounts.ts, db/routing.ts routeUnassignedTicketsInCategories),
// each inside the caller's transaction, which took the company row lock
// first (routing must not run beside another routing in the company).
// Whoever routing picks is emailed after commit (a queued job).

// UnassignForRemovalWithin takes a removed teammate's open requests off
// them, each recorded as done by the app (actor empty) about them, and
// routes them again, oldest first. routed_to_user_id stays: routing's first
// pick is kept for good.
func UnassignForRemovalWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, userID string) error {
	const unassign = `
		UPDATE tickets SET assigned_to_user_id = NULL, assigned_automatically = NULL
		WHERE company_id = $1 AND assigned_to_user_id = $2 AND status = 'open'
		RETURNING id, ticket_number`
	ids, err := unassignedIDs(ctx, tx, unassign, company, userID)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := recordChangeWithin(ctx, tx, company, id, "unassigned", "", userID, nil); err != nil {
			return err
		}
	}
	return RouteAgainWithin(ctx, tx, company, ids)
}

// ForgetAccountWithin takes an account that never confirmed off every
// request before it is deleted: routing's pick cleared (it was someone who
// never confirmed), every request it holds unassigned (recorded without
// naming it), its open ones routed again, and its name cleared from their
// history (the same-company foreign keys would refuse the delete).
func ForgetAccountWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, userID string) error {
	if _, err := tx.Exec(ctx, `UPDATE tickets SET routed_to_user_id = NULL WHERE company_id = $1 AND routed_to_user_id = $2`, company.String(), userID); err != nil {
		return err
	}
	const unassign = `
		UPDATE tickets SET assigned_to_user_id = NULL, assigned_automatically = NULL
		WHERE company_id = $1 AND assigned_to_user_id = $2
		RETURNING id, ticket_number`
	ids, err := unassignedIDs(ctx, tx, unassign, company, userID)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := recordChangeWithin(ctx, tx, company, id, "unassigned", "", "", nil); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE ticket_activity SET target_user_id = NULL WHERE company_id = $1 AND target_user_id = $2`, company.String(), userID); err != nil {
		return err
	}
	return RouteAgainWithin(ctx, tx, company, ids)
}

// RouteWaitingInCategoriesWithin routes the company's open, unassigned
// requests in these categories (someone started handling them, or an owner
// restored one), oldest first.
func RouteWaitingInCategoriesWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, categoryIDs []string) error {
	if len(categoryIDs) == 0 {
		return nil
	}
	const waiting = `
		SELECT tickets.id FROM tickets
		JOIN categories ON categories.company_id = tickets.company_id AND categories.name = tickets.category
		WHERE tickets.company_id = $1 AND tickets.status = 'open' AND tickets.assigned_to_user_id IS NULL
			AND categories.id::text = ANY($2::text[])
		ORDER BY tickets.ticket_number`
	rows, err := tx.Query(ctx, waiting, company.String(), categoryIDs)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return RouteAgainWithin(ctx, tx, company, ids)
}

// RouteAgainWithin routes each of these requests that is still open,
// unassigned and in a category, in this order.
func RouteAgainWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, ticketIDs []string) error {
	for _, id := range ticketIDs {
		if _, err := routeIfUnassignedWithin(ctx, tx, company, id); err != nil {
			return err
		}
	}
	return nil
}

// unassignedIDs runs an UPDATE ... RETURNING id, ticket_number and gives the
// ids, oldest request first.
func unassignedIDs(ctx context.Context, tx database.Tx, statement string, company tenant.CompanyID, userID string) ([]string, error) {
	rows, err := tx.Query(ctx, statement, company.String(), userID)
	if err != nil {
		return nil, err
	}
	type numbered struct {
		id     string
		number int
	}
	var found []numbered
	for rows.Next() {
		var n numbered
		if err := rows.Scan(&n.id, &n.number); err != nil {
			rows.Close()
			return nil, err
		}
		found = append(found, n)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Slice(found, func(a, b int) bool { return found[a].number < found[b].number })
	ids := make([]string, len(found))
	for i, n := range found {
		ids[i] = n.id
	}
	return ids, nil
}
