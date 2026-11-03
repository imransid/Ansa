package autopost

import (
	"context"
	"time"

	"ansa/core/internal/packages"
)

// packageAllows: the company's package includes posts this often (step 57),
// and a post written with ansa's AI is one of its AI replies this month
// (counted here; the business's own key isn't).
func (w *Writer) packageAllows(ctx context.Context, company Company, d *details) (bool, error) {
	pkg, err := packages.Of(ctx, w.Pool, company.ID, time.Now())
	if err != nil || !pkg.AllowsPosting(company.Frequency) {
		return false, err
	}
	if d.ownKey {
		return true, nil
	}
	return packages.TakeAIReply(ctx, w.Pool, company.ID, time.Now())
}
