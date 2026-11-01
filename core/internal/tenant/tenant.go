// Package tenant holds the company id type every database function takes.
//
// A CompanyID can only be made by code that found the company on the server
// side (a verified session, a webhook secret core issued): FromTrustedSource
// is the one door, and every call of it is a place to review. A plain string
// is never accepted where a company is meant (docs/backend/security.md, rule 1).
package tenant

import (
	"errors"
	"regexp"
	"strings"
)

// CompanyID is one company's id, as PostgreSQL stores it (a lowercase uuid).
type CompanyID struct {
	value string
}

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// ErrNotACompanyID is returned for anything that isn't a uuid.
var ErrNotACompanyID = errors.New("not a company id")

// FromTrustedSource makes a CompanyID from an id the server itself found
// (a session row, a connection row). Never call it with a value from a
// request body, a query string or a header a client controls.
func FromTrustedSource(id string) (CompanyID, error) {
	lower := strings.ToLower(id)
	if !uuidPattern.MatchString(lower) {
		return CompanyID{}, ErrNotACompanyID
	}
	return CompanyID{value: lower}, nil
}

// String is the id for a query parameter. Never write it into SQL text.
func (c CompanyID) String() string {
	return c.value
}

// IsZero is true for a CompanyID that was never set: refuse to query with it.
func (c CompanyID) IsZero() bool {
	return c.value == ""
}
