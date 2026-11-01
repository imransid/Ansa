package media

import (
	"context"
	"errors"
	"strings"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/files"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// Uploads: the name's type AND the file's own first bytes must agree (the
// API checks them with CheckFile first), stored privately, then recorded.

// ErrFull: one more file would take the company past its library's cap.
var ErrFull = errors.New("media: the company's library is full")

// ErrNotAllowed: the person isn't active in the company now.
var ErrNotAllowed = errors.New("media: not allowed")

// CheckAltText is what a picture shows as saved (one plain line, as it is
// published with the image), or why it can't be.
func CheckAltText(text string) (string, string) {
	cleaned := contentrules.CleanDraftLine(text)
	if utf16Length(cleaned) > AltTextMax {
		return "", "A description can be at most 1,000 characters."
	}
	return cleaned, ""
}

// Upload stores a checked file of one company and records it, added by
// actorUserID while they are active in it. Two uploads at the same moment
// can both pass the cap, by a file at most (uploads are rate limited):
// fine for a cost cap, nobody gets data. A file whose row isn't saved is
// removed (best effort), since nobody could reach or delete it.
func Upload(ctx context.Context, pool *database.Pool, store *files.Store, company tenant.CompanyID, actorUserID, name string, data []byte, altText string) (string, error) {
	contentType, problem := CheckFile(name, data)
	if problem != "" {
		return "", errors.New("media: " + problem)
	}
	count, total, err := Totals(ctx, pool, company)
	if err != nil {
		return "", err
	}
	if count >= MaxAssetsPerCompany || total+len(data) > MaxBytesPerCompany {
		return "", ErrFull
	}
	assetID, err := conversations.NewID()
	if err != nil {
		return "", err
	}
	key := StorageKey(company.String(), assetID, contentType)
	if err := store.Put(ctx, key, data, contentType); err != nil {
		return "", err
	}
	width, height, sized := ImageSize(data, contentType)
	err = database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role == "" {
			return errors.Join(err, ErrNotAllowed)
		}
		// Every column named: a source, a job or a company of its own can't ride along.
		const insert = `
			INSERT INTO media_assets (id, company_id, kind, source, content_type, size_bytes, width, height, storage_key, original_name, alt_text, created_by_user_id)
			VALUES ($1, $2, $3, 'upload', $4, $5, $6, $7, $8, $9, $10, $11)`
		_, err = tx.Exec(ctx, insert, assetID, company.String(), KindOfType[contentType], contentType, len(data),
			sizeOrNil(width, sized), sizeOrNil(height, sized), key, shownName(name, ExtensionOfType[contentType]), altText, actorUserID)
		return err
	})
	if err != nil {
		_ = store.Delete(ctx, key)
		return "", err
	}
	return assetID, nil
}

// shownName is the file's name as the list shows it: one plain line (a
// right-to-left override can't disguise it), at most 200 characters.
func shownName(name, extension string) string {
	runes := []rune(plaintext.SingleLine(name))
	shown := strings.TrimSpace(string(runes[:min(len(runes), OriginalNameMax)]))
	if shown == "" {
		return "file." + extension
	}
	return shown
}

func sizeOrNil(side int, known bool) any {
	if !known {
		return nil
	}
	return side
}

// utf16Length counts as the old JavaScript did, so both backends accept
// the same texts.
func utf16Length(text string) int {
	n := 0
	for _, r := range text {
		n++
		if r >= 0x10000 {
			n++
		}
	}
	return n
}
