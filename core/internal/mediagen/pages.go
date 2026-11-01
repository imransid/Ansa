package mediagen

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/drafts"
	"ansa/core/internal/media"
	"ansa/core/internal/tenant"
)

// What the media page and a draft's page show about requests.

// JobsShown: the media page lists the newest 20 requests.
const JobsShown = 20

// Job is one request as the media page lists it.
type Job struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Prompt   string `json:"prompt"`
	Provider string `json:"provider"`
	Status   string `json:"status"`
	Attempts int    `json:"attempts"`
	// A code, and its plain words.
	LastError     *string `json:"lastError"`
	LastErrorText *string `json:"lastErrorText"`
	CostCents     *int    `json:"costCents"`
	// What it made, while that asset exists, and the library page showing it.
	AssetID        *string    `json:"assetId"`
	AssetDeletedAt *time.Time `json:"assetDeletedAt"`
	LibraryPage    *int       `json:"libraryPage"`
	DraftID        *string    `json:"draftId"`
	DraftTopic     *string    `json:"draftTopic"`
	// What that draft has attached now: this job's asset, or something else.
	DraftMediaAssetID *string    `json:"draftMediaAssetId"`
	RequestedByName   *string    `json:"requestedByName"`
	CreatedAt         time.Time  `json:"createdAt"`
	FinishedAt        *time.Time `json:"finishedAt"`
	IsStuck           bool       `json:"isStuck"`
}

// Jobs are one company's newest requests, with who asked, the draft they
// are for and whether what they made still exists. Every join matches company_id.
func (s *Service) Jobs(ctx context.Context, company tenant.CompanyID) ([]Job, error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT j.id::text, j.kind, j.prompt, j.provider, j.status, j.attempts, j.last_error, j.cost_cents, asset.id::text, j.asset_deleted_at,
			j.draft_id::text, d.topic, d.media_asset_id::text, u.name, j.created_at, j.finished_at,
			COALESCE((j.status = 'queued' AND j.created_at < now() - make_interval(mins => 2))
				OR (j.status = 'running' AND j.started_at < now() - make_interval(mins => 15)), false)
		FROM media_generation_jobs AS j
		LEFT JOIN users AS u ON u.id = j.requested_by_user_id AND u.company_id = j.company_id
		LEFT JOIN content_drafts AS d ON d.id = j.draft_id AND d.company_id = j.company_id
		LEFT JOIN media_assets AS asset ON asset.id = j.asset_id AND asset.company_id = j.company_id
		WHERE j.company_id = $1 ORDER BY j.created_at DESC, j.id DESC LIMIT $2`, company.String(), JobsShown)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	jobs := []Job{}
	var assets []string
	for rows.Next() {
		var j Job
		if err := rows.Scan(&j.ID, &j.Kind, &j.Prompt, &j.Provider, &j.Status, &j.Attempts, &j.LastError, &j.CostCents, &j.AssetID, &j.AssetDeletedAt,
			&j.DraftID, &j.DraftTopic, &j.DraftMediaAssetID, &j.RequestedByName, &j.CreatedAt, &j.FinishedAt, &j.IsStuck); err != nil {
			return nil, err
		}
		if j.LastError != nil {
			words := DescribeError(*j.LastError)
			j.LastErrorText = &words
		}
		if j.AssetID != nil {
			assets = append(assets, *j.AssetID)
		}
		jobs = append(jobs, j)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	pages, err := media.LibraryPages(ctx, s.Pool, company, assets)
	for i := range jobs {
		if page, found := pages[derefOr(jobs[i].AssetID)]; found {
			jobs[i].LibraryPage = &page
		}
	}
	return jobs, err
}

// DraftPanel is what a draft's page shows under Media, at its version on screen.
type DraftPanel struct {
	// What the format attaches ("" for a text post, which takes none).
	Kind                string        `json:"kind"`
	Attached            *media.Asset  `json:"attached"`
	AttachedLibraryPage *int          `json:"attachedLibraryPage"`
	Choices             []media.Asset `json:"choices"`
	// The request made from this draft still waiting or being made.
	// ForThisVersion: asked at the version on screen, so what it makes is
	// attached as the next version (the editor waits for it); otherwise it
	// only goes to the library.
	OpenJob *panelJob `json:"openJob"`
	// The newest request made at the version on screen, when it failed.
	LastFailure *failure `json:"lastFailure"`
	// Whether "Make the image with the AI" can ask anyone (posts with an image only).
	Generation Availability `json:"generation"`
}

type panelJob struct {
	OpenJob
	ForThisVersion bool `json:"forThisVersion"`
}

type failure struct {
	Code string `json:"code"`
	Text string `json:"text"`
}

// DraftPanel reads one draft's media panel.
func (s *Service) DraftPanel(ctx context.Context, company tenant.CompanyID, draftID, format string, version int, attachedID *string) (DraftPanel, error) {
	kind := drafts.MediaKindOfFormat(format)
	generation := s.Mode.Availability()
	generation.Available = generation.Available && kind == "image"
	panel := DraftPanel{Kind: kind, Choices: []media.Asset{}, Generation: generation}
	if kind == "" {
		return panel, nil
	}
	var err error
	if attachedID != nil {
		if panel.Attached, _, err = media.Find(ctx, s.Pool, company, *attachedID); err != nil {
			return panel, err
		}
		pages, err := media.LibraryPages(ctx, s.Pool, company, []string{*attachedID})
		if page, found := pages[*attachedID]; found && err == nil {
			panel.AttachedLibraryPage = &page
		}
	}
	if panel.Choices, err = media.Choices(ctx, s.Pool, company, kind); err != nil {
		return panel, err
	}
	open, err := OpenJobOfDraft(ctx, s.Pool, company, draftID)
	if err != nil {
		return panel, err
	}
	if open != nil {
		panel.OpenJob = &panelJob{OpenJob: *open, ForThisVersion: open.DraftVersion != nil && *open.DraftVersion == version}
	}
	panel.LastFailure, err = s.lastFailureAt(ctx, company, draftID, version)
	return panel, err
}

// lastFailureAt: the newest request of a draft made at this version, when it failed.
func (s *Service) lastFailureAt(ctx context.Context, company tenant.CompanyID, draftID string, version int) (*failure, error) {
	var status string
	var code *string
	err := s.Pool.QueryRow(ctx, `SELECT status, last_error FROM media_generation_jobs WHERE company_id = $1 AND draft_id = $2 AND draft_version = $3
		ORDER BY created_at DESC, id DESC LIMIT 1`, company.String(), draftID, version).Scan(&status, &code)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (status != "failed" || code == nil)) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &failure{Code: *code, Text: DescribeError(*code)}, nil
}

func derefOr(id *string) string {
	if id == nil {
		return ""
	}
	return *id
}
