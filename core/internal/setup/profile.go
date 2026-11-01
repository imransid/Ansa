package setup

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/settings"
	"ansa/core/internal/tenant"
)

// Profile is everything the setup and Settings → What it knows show.
type Profile struct {
	Kind          string        `json:"kind"`
	CompanyName   string        `json:"companyName"`
	BusinessType  *string       `json:"businessType"`
	Description   string        `json:"description"`
	Address       string        `json:"address"`
	Settings      settings.View `json:"settings"`
	SetupProgress int           `json:"setupProgress"`
	SetupFinished bool          `json:"setupFinished"`
	Steps         []string      `json:"steps"`
}

// ReadProfile reads the company's setup, settings and the facts setup writes.
func ReadProfile(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (Profile, error) {
	var p Profile
	const statement = `SELECT kind, name, business_type, setup_progress, setup_finished_at IS NOT NULL FROM companies WHERE id = $1`
	if err := pool.QueryRow(ctx, statement, company.String()).Scan(&p.Kind, &p.CompanyName, &p.BusinessType, &p.SetupProgress, &p.SetupFinished); err != nil {
		return p, err
	}
	var err error
	if p.Description, err = confirmedFact(ctx, pool, company, "description"); err != nil {
		return p, err
	}
	if p.Address, err = confirmedFact(ctx, pool, company, "location"); err != nil {
		return p, err
	}
	p.Steps = StepsFor(p.Kind)
	p.Settings, err = settings.Read(ctx, pool, company)
	return p, err
}

func confirmedFact(ctx context.Context, pool *database.Pool, company tenant.CompanyID, topic string) (string, error) {
	var value *string
	err := pool.QueryRow(ctx, `SELECT confirmed_value FROM business_facts WHERE company_id = $1 AND topic = $2`, company.String(), topic).Scan(&value)
	if errors.Is(err, pgx.ErrNoRows) || value == nil {
		return "", nil
	}
	return *value, err
}
