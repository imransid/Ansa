// Package documents is the company's uploaded documents (the old
// services/documents.ts, db/documents.ts, lib/document-files.ts): PDF, Word
// (.docx), text, Markdown and CSV files of up to 4 MB, kept in private
// storage ([files]) under documents/<companyId>/<documentId>.<ext>. Owners
// upload and delete; everyone in the company lists and downloads them
// (always "save as", through a 5-minute signed link or core's own route).
// "Add to knowledge" moves with the Knowledge page.
package documents

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/files"
	"ansa/core/internal/tenant"
)

// Under Vercel's 4.5 MB request limit; per company at most 100 files, 200 MB.
const (
	MaxBytes           = 4 << 20
	maxPerCompany      = 100
	maxBytesPerCompany = 200 << 20
	// How long a download link works.
	LinkSeconds = 5 * 60
)

// Only plain document types, by extension; the stored type comes from this
// list, never from the browser.
var types = map[string]string{
	"pdf":  "application/pdf",
	"txt":  "text/plain",
	"md":   "text/markdown",
	"csv":  "text/csv",
	"docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

// The words the page shows (the same as the browser's own check).
const (
	TooBig    = "Files can be at most 4 MB."
	WrongType = "Upload a PDF, Word (.docx), text, Markdown or CSV file."
	Empty     = "Choose a file to upload."
	Full      = "Your company has reached its storage limit (100 files or 200 MB). Delete a document to make room."
)

var extensionPattern = regexp.MustCompile(`(?i)\.([a-z0-9]+)$`)

// Check says whether a file may be uploaded: its extension and stored type,
// or why not in the page's words.
func Check(name string, size int) (extension, contentType, problem string) {
	if size == 0 {
		return "", "", Empty
	}
	match := extensionPattern.FindStringSubmatch(name)
	if match == nil {
		return "", "", WrongType
	}
	extension = strings.ToLower(match[1])
	contentType, known := types[extension]
	switch {
	case !known:
		return "", "", WrongType
	case size > MaxBytes:
		return "", "", TooBig
	}
	return extension, contentType, ""
}

// Document is one stored document.
type Document struct {
	ID          string    `json:"id"`
	FileName    string    `json:"fileName"`
	ContentType string    `json:"contentType"`
	SizeBytes   int       `json:"sizeBytes"`
	StorageKey  string    `json:"-"`
	CreatedAt   time.Time `json:"createdAt"`
}

// List is the company's documents, newest first.
func List(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]Document, error) {
	rows, err := pool.Query(ctx, `SELECT id, file_name, content_type, size_bytes, storage_key, created_at FROM company_documents WHERE company_id = $1 ORDER BY created_at DESC`, company.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Document{}
	for rows.Next() {
		var d Document
		if err := rows.Scan(&d.ID, &d.FileName, &d.ContentType, &d.SizeBytes, &d.StorageKey, &d.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, d)
	}
	return list, rows.Err()
}

// ErrFull: one more file would take the company past its cap.
var ErrFull = errors.New("documents: the company's storage is full")

// Upload stores a checked file, then its row. Two uploads at the same
// moment can both pass the cap, by a file at most (uploads are rate
// limited): fine for a cost cap, nobody gets data. If the row can't be
// saved, nobody could reach the file: it is removed (best effort).
func Upload(ctx context.Context, pool *database.Pool, store *files.Store, company tenant.CompanyID, actorUserID, name string, data []byte) error {
	extension, contentType, problem := Check(name, len(data))
	if problem != "" {
		return errors.New("documents: " + problem)
	}
	var count, total int
	if err := pool.QueryRow(ctx, `SELECT count(*), COALESCE(sum(size_bytes), 0) FROM company_documents WHERE company_id = $1`, company.String()).Scan(&count, &total); err != nil {
		return err
	}
	if count >= maxPerCompany || total+len(data) > maxBytesPerCompany {
		return ErrFull
	}
	id, err := conversations.NewID()
	if err != nil {
		return err
	}
	// The company id in the key keeps every company's files apart in the bucket.
	key := "documents/" + company.String() + "/" + id + "." + extension
	if err := store.Put(ctx, key, data, contentType); err != nil {
		return err
	}
	const insert = `
		INSERT INTO company_documents (id, company_id, file_name, content_type, size_bytes, storage_key, uploaded_by_user_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`
	if _, err := pool.Exec(ctx, insert, id, company.String(), shownName(name, extension), contentType, len(data), key, actorUserID); err != nil {
		_ = store.Delete(ctx, key)
		return err
	}
	return nil
}

// shownName is the file's name as the list shows it: control characters
// out, at most 200 characters.
func shownName(name, extension string) string {
	cleaned := []rune(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, name))
	if len(cleaned) > 200 {
		cleaned = cleaned[:200]
	}
	if len(cleaned) == 0 {
		return "document." + extension
	}
	return string(cleaned)
}

// Find reads one document of the company (nil: none).
func Find(ctx context.Context, pool *database.Pool, company tenant.CompanyID, documentID string) (*Document, error) {
	var d Document
	err := pool.QueryRow(ctx, `SELECT id, file_name, content_type, size_bytes, storage_key, created_at FROM company_documents WHERE company_id = $1 AND id::text = $2`,
		company.String(), documentID).Scan(&d.ID, &d.FileName, &d.ContentType, &d.SizeBytes, &d.StorageKey, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &d, err
}

// Delete removes one document: the file FIRST, then the row (if storage
// refuses, the document stays listed and the owner tries again; the other
// way round a failed file delete would leave a file nothing points at),
// clearing the source of the knowledge articles made from it in the row's
// transaction (the articles stay). False: no such document.
func Delete(ctx context.Context, pool *database.Pool, store *files.Store, company tenant.CompanyID, documentID string) (bool, error) {
	document, err := Find(ctx, pool, company, documentID)
	if err != nil || document == nil {
		return false, err
	}
	if err := store.Delete(ctx, document.StorageKey); err != nil {
		return false, err
	}
	err = database.InTx(ctx, pool, func(tx database.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT id FROM company_documents WHERE company_id = $1 AND id = $2 FOR UPDATE`, company.String(), document.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE knowledge_articles SET source_document_id = NULL WHERE company_id = $1 AND source_document_id = $2`, company.String(), document.ID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM company_documents WHERE company_id = $1 AND id = $2`, company.String(), document.ID)
		return err
	})
	return err == nil, err
}
