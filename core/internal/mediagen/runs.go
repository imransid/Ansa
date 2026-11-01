package mediagen

import (
	"context"
	"time"

	"ansa/core/internal/conversations"
	"ansa/core/internal/logging"
	"ansa/core/internal/media"
	"ansa/core/internal/tenant"
)

// Running one request: right after the answer, and again from the
// periodic task for one whose run never started or was cut off. The result
// is copied into the company's private storage at once and saved with its
// asset in one transaction; a failure saves a code and never an asset.

// How long a run may wait for the service (its start, then its polls); a
// service still working then is polled by a later run (the job keeps its id).
const runBudget = 120 * time.Second

// LongestRun is the longest one run can take when everything is slow: the
// budget, the download, storing the file and the database work.
const LongestRun = runBudget + downloadTimeout + 20*time.Second

// The outcomes of a run. Unfinished: the service is still working (or the
// database failed); a later run takes it up. NotClaimed: another run has
// it, or it ended.
const (
	Succeeded  = "succeeded"
	Failed     = "failed"
	Unfinished = "unfinished"
	NotClaimed = "not-claimed"
	GivenUp    = "given-up"
)

// Run claims and runs one request of one company. Never fails: a database
// error leaves it "being made" for a run 15 minutes later.
func (s *Service) Run(ctx context.Context, company tenant.CompanyID, jobID string) string {
	claimed, outcome := s.Claim(ctx, company, jobID)
	if claimed == nil {
		return outcome
	}
	return s.RunClaimed(ctx, company, jobID, claimed)
}

// Claim claims one request (ONE UPDATE); one cut off as often as allowed
// is ended "interrupted" instead (GivenUp). "Start now" claims before the
// page answers, so the page it gets back already shows it being made.
func (s *Service) Claim(ctx context.Context, company tenant.CompanyID, jobID string) (*Claimed, string) {
	claimed, err := claimJob(ctx, s.Pool, company, jobID)
	if err != nil {
		s.Log.Error("media generation failed", logging.ErrorType(err))
		return nil, Unfinished
	}
	if claimed != nil {
		return claimed, ""
	}
	if gaveUp, err := giveUpInterrupted(ctx, s.Pool, company, jobID); err != nil || !gaveUp {
		return nil, NotClaimed
	}
	return nil, GivenUp
}

// RunInBackground runs a request after the answer, with its own time limit
// (a run cut off by a restart is taken up by the periodic task).
func (s *Service) RunInBackground(company tenant.CompanyID, jobID string, claimed *Claimed) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), LongestRun)
		defer cancel()
		if claimed == nil {
			s.Run(ctx, company, jobID)
			return
		}
		s.RunClaimed(ctx, company, jobID, claimed)
	}()
}

// RunClaimed asks the claimed job's service, then keeps the result or ends
// the job failed with a code.
func (s *Service) RunClaimed(ctx context.Context, company tenant.CompanyID, jobID string, claimed *Claimed) string {
	provider := s.Mode.ProviderForJob(claimed.Provider)
	if provider == nil {
		return s.endFailed(ctx, company, jobID, claimed, "provider_unavailable", nil)
	}
	budget, sleep := s.Budget, s.Sleep
	if budget == 0 {
		budget = runBudget
	}
	if sleep == nil {
		sleep = time.Sleep
	}
	saveID := func(id string) error { return saveProviderJobID(ctx, s.Pool, company, jobID, claimed.Attempt, id) }
	got, err := askProvider(ctx, provider, claimed, budget, sleep, saveID)
	switch {
	case err != nil:
		s.Log.Error("media generation failed", logging.ErrorType(err))
		return Unfinished
	case got.status == "unfinished":
		return Unfinished
	case got.status == "failed":
		return s.endFailed(ctx, company, jobID, claimed, got.code, got.costCents)
	}
	data, contentType, code := fetchAndCheck(ctx, got.output, provider, claimed.Kind)
	if code != "" {
		return s.endFailed(ctx, company, jobID, claimed, code, got.costCents)
	}
	return s.keepFile(ctx, company, jobID, claimed, provider.Name(), data, contentType, got.costCents)
}

// keepFile stores the file under its company, then saves the asset with
// the job (and the draft). A file whose row isn't saved is removed.
func (s *Service) keepFile(ctx context.Context, company tenant.CompanyID, jobID string, claimed *Claimed, providerName string, data []byte, contentType string, costCents *int) string {
	assetID, err := conversations.NewID()
	if err != nil {
		return Unfinished
	}
	key := media.StorageKey(company.String(), assetID, contentType)
	if err := s.Files.Put(ctx, key, data, contentType); err != nil {
		s.Log.Error("media generation storage failed", logging.ErrorType(err))
		return s.endFailed(ctx, company, jobID, claimed, "storage_failed", costCents)
	}
	file := generatedFile{assetID: assetID, storageKey: key, kind: media.KindOfType[contentType], contentType: contentType,
		size: len(data), provider: providerName, costCents: costCents}
	if width, height, known := media.ImageSize(data, contentType); known {
		file.width, file.height = width, height
	}
	outcome, err := saveGenerated(ctx, s.Pool, company, jobID, claimed, file)
	if err == nil && outcome == saved {
		return Succeeded
	}
	s.removeFile(ctx, key)
	switch {
	case err != nil:
		s.Log.Error("media generation failed", logging.ErrorType(err))
		return Unfinished
	case outcome == lostClaim:
		return NotClaimed
	}
	s.Log.Warn("media generation failed", logging.Code("library_full"))
	return Failed
}

// endFailed ends the job failed with this code, if this run still holds it.
func (s *Service) endFailed(ctx context.Context, company tenant.CompanyID, jobID string, claimed *Claimed, code string, costCents *int) string {
	ended, err := failJob(ctx, s.Pool, company, jobID, claimed.Attempt, code, costCents)
	// A fixed code: safe to log, and worth an alert when it repeats.
	s.Log.Warn("media generation failed", logging.Code(code))
	if err != nil || !ended {
		return NotClaimed
	}
	return Failed
}

// removeFile removes a file whose row was never saved. A failure leaves a
// file nothing points at: logged by class, never shown, never retried.
func (s *Service) removeFile(ctx context.Context, key string) {
	if err := s.Files.Delete(ctx, key); err != nil {
		s.Log.Error("media file delete failed", logging.ErrorType(err))
	}
}
