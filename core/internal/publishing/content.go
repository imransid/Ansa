package publishing

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/drafts"
	"ansa/core/internal/tenant"
)

// draftContent is what the content check and the post read of a draft
// besides the columns core/internal/drafts reads: a YouTube video's title,
// a video's script, and the image or video attached from the media library.
type draftContent struct {
	Title, VideoScript string
	// nil: nothing attached.
	Media *attachedMedia
}

// attachedMedia is a draft's image or video: what the rules read (its kind,
// and its alt text, published with it) and where its file is stored.
type attachedMedia struct {
	Kind, AltText, StorageKey, ContentType string
}

// rowReader is a transaction (or the pool): one row at a time.
type rowReader interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// readContentWithin reads one draft's title, video script and attached
// image or video, inside the caller's transaction (the draft's row locked,
// or one snapshot). The asset is read, not locked: a delete or an alt text
// change locks its drafts first (the old lock order).
func readContentWithin(ctx context.Context, q rowReader, company tenant.CompanyID, draftID string) (draftContent, error) {
	const statement = `
		SELECT content_drafts.title, content_drafts.video_script,
			media_assets.kind, media_assets.alt_text, media_assets.storage_key, media_assets.content_type
		FROM content_drafts
		LEFT JOIN media_assets ON media_assets.company_id = content_drafts.company_id AND media_assets.id = content_drafts.media_asset_id
		WHERE content_drafts.company_id = $1 AND content_drafts.id = $2`
	var content draftContent
	var kind, altText, storageKey, contentType *string
	err := q.QueryRow(ctx, statement, company.String(), draftID).Scan(&content.Title, &content.VideoScript, &kind, &altText, &storageKey, &contentType)
	if errors.Is(err, pgx.ErrNoRows) {
		return draftContent{}, drafts.ErrNotFound
	}
	if err != nil {
		return draftContent{}, err
	}
	if kind != nil && altText != nil && storageKey != nil && contentType != nil {
		content.Media = &attachedMedia{Kind: *kind, AltText: *altText, StorageKey: *storageKey, ContentType: *contentType}
	}
	return content, nil
}

// forChecks is a stored draft as the pure checks read it, with what the
// confirmed facts now say about it: blocked by a rule of its platform (its
// format, its image or video, its title, its text's length, its hashtags)
// or by a confirmed word to avoid (also in the media's alt text), and
// whether its claims need an owner. The old reviewDraft's blocking issues.
func forChecks(d *drafts.Draft, content draftContent, factsNow map[string]string) (Draft, bool) {
	var media *contentrules.Media
	if content.Media != nil {
		media = &contentrules.Media{Kind: content.Media.Kind, AltText: content.Media.AltText}
	}
	rulesDraft := contentrules.Draft{Platform: d.Platform, Format: d.Format, Title: content.Title, Body: d.Body,
		CallToAction: d.CallToAction, VideoScript: content.VideoScript, Hashtags: d.Hashtags}
	issues := contentrules.CheckDraft(rulesDraft, media, contentrules.ReadWordsToAvoid(factsNow["words_to_avoid"]))
	return Draft{
		Platform: d.Platform, Format: d.Format, Status: d.Status, Pillar: d.Pillar, Version: d.Version,
		ApprovedByUserID: d.ApprovedByUserID, ApprovedVersion: d.ApprovedVersion,
		ClaimsChecked: drafts.ClaimsChecked(*d, factsNow),
	}, contentrules.HasBlocking(issues)
}

// publishes says whether ansa publishes this format to this platform now
// (contentrules.PublishedFormats: what the queue may schedule and send).
func publishes(platform, format string) bool {
	return contentrules.Takes(contentrules.PublishedFormats[platform], format)
}
