package socialconnect

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// listedConnection is one connection as the Accounts page reads it: never
// a token, only whether a refresh token is kept.
type listedConnection struct {
	id, platform, displayName, accountKind, status string
	scopes                                         []string
	lastError                                      *string
	accessExpiresAt, refreshExpiresAt              *time.Time
	hasRefreshToken, isStandIn                     bool
	connectedAt                                    time.Time
	connectedByName                                *string
	disconnectedAt                                 *time.Time
}

// listConnections lists one company's connections with who connected each
// (a person of the same company), by platform and name.
func listConnections(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]listedConnection, error) {
	const statement = `
		SELECT social_connections.id, social_connections.platform, social_connections.display_name, social_connections.account_kind,
			social_connections.scopes, social_connections.status, social_connections.last_error, social_connections.access_expires_at,
			social_connections.refresh_expires_at, social_connections.refresh_token_encrypted IS NOT NULL, social_connections.is_stand_in,
			social_connections.connected_at, users.name, social_connections.disconnected_at
		FROM social_connections
		LEFT JOIN users ON users.id = social_connections.connected_by_user_id AND users.company_id = social_connections.company_id
		WHERE social_connections.company_id = $1
		ORDER BY social_connections.platform, social_connections.display_name, social_connections.id`
	rows, err := pool.Query(ctx, statement, company.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var listed []listedConnection
	for rows.Next() {
		var c listedConnection
		if err := rows.Scan(&c.id, &c.platform, &c.displayName, &c.accountKind, &c.scopes, &c.status, &c.lastError, &c.accessExpiresAt,
			&c.refreshExpiresAt, &c.hasRefreshToken, &c.isStandIn, &c.connectedAt, &c.connectedByName, &c.disconnectedAt); err != nil {
			return nil, err
		}
		listed = append(listed, c)
	}
	return listed, rows.Err()
}

// renewsItself: a refresh token is kept and hasn't passed its own end (a
// refresh token past it, Google's 7 days while ansa's app is in Testing,
// renews nothing).
func (c listedConnection) renewsItself(now time.Time) bool {
	return c.hasRefreshToken && (c.refreshExpiresAt == nil || c.refreshExpiresAt.After(now))
}

// hasRunOut: connected, but its access ended and nothing can renew it.
func (c listedConnection) hasRunOut(now time.Time) bool {
	return c.status == "connected" && !c.renewsItself(now) && c.accessExpiresAt != nil && !c.accessExpiresAt.After(now)
}

// statusAsOfNow is what the next use would find: one past its end with
// nothing to renew it needs a reconnect even before anything tried to use it.
func (c listedConnection) statusAsOfNow(now time.Time) string {
	if c.hasRunOut(now) {
		return "needs_reauth"
	}
	return c.status
}
