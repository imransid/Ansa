package home

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/packages"
	"ansa/core/internal/tenant"
)

// PackageStatus is what Home says about the company's package (step 57,
// owners only): which one it is, when the free trial ends, and what was
// used this month. The screens decide what needs saying (a trial ending,
// AI replies or call minutes running out).
type PackageStatus struct {
	Package     packages.Package `json:"package"`
	TrialEndsAt time.Time        `json:"trialEndsAt"`
	Usage       packages.Usage   `json:"usage"`
}

// ReadPackageStatus reads it.
func ReadPackageStatus(ctx context.Context, pool *database.Pool, company tenant.CompanyID, now time.Time) (PackageStatus, error) {
	var status PackageStatus
	var err error
	if status.Package, err = packages.Of(ctx, pool, company, now); err != nil {
		return status, err
	}
	if err := pool.QueryRow(ctx, `SELECT trial_ends_at FROM companies WHERE id = $1`, company.String()).Scan(&status.TrialEndsAt); err != nil {
		return status, err
	}
	status.Usage, err = packages.ReadUsage(ctx, pool, company, now)
	return status, err
}
