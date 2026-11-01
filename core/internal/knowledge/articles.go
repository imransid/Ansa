package knowledge

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// The kinds and statuses an article may have (CHECKs list the same).
var (
	Kinds    = map[string]bool{"faq": true, "policy": true, "product": true, "guide": true, "solution": true, "document": true, "website": true}
	statuses = map[string]bool{"draft": true, "approved": true, "archived": true}
)

// At most 1,000 articles per company (about 20 MB of text): signup is open
// and payments enforce nothing yet.
const articlesPerCompany = 1_000

// Fields are what a person writes (checked by the API first).
type Fields struct {
	Title, Body, Kind              string
	UseForSupport, UseForMarketing bool
}

// Source is where new articles came from: a solved request's number (only a
// claim: it counts only for a solved request of this company), a stored
// document, or a web page's address. Zero value: none.
type Source struct {
	TicketNumber int
	DocumentID   string
	URL          string
}

// CanEdit: anyone in the company changes drafts; an approved article is what
// the AI uses, so only owners change it (it stays approved, in their name);
// nobody edits an archived one (an owner restores it first).
func CanEdit(role, status string) bool {
	return status == "draft" || (status == "approved" && role == "owner")
}

// CreateDrafts saves new DRAFT articles written by actorUserID, with their
// pieces, in ONE transaction (an import's parts all land, or none). The
// company row lock first: two saves at once count the 1,000 one after the
// other. Imports (a document, a web page) are owners' only. Outcomes:
// "created", "refused", "full", "source-gone" (the document was deleted
// meanwhile).
func CreateDrafts(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, articles []Fields, source Source) ([]string, string, error) {
	var ids []string
	outcome := "created"
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil {
			return err
		}
		if role == "" || ((source.DocumentID != "" || source.URL != "") && role != "owner") {
			outcome = "refused"
			return nil
		}
		var count int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM knowledge_articles WHERE company_id = $1`, company.String()).Scan(&count); err != nil {
			return err
		}
		if count+len(articles) > articlesPerCompany {
			outcome = "full"
			return nil
		}
		documentID, ticketID, found, err := sourceColumnsWithin(ctx, tx, company, source)
		if err != nil {
			return err
		}
		if !found {
			outcome = "source-gone"
			return nil
		}
		// Every column named: a status, company or approver can't ride along.
		const insert = `
			INSERT INTO knowledge_articles (company_id, title, body, kind, use_for_support, use_for_marketing,
				source_document_id, source_ticket_id, source_url, created_by_user_id, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, ''), $10, $10)
			RETURNING id`
		for _, article := range articles {
			var id string
			if err := tx.QueryRow(ctx, insert, company.String(), article.Title, article.Body, article.Kind, article.UseForSupport, article.UseForMarketing,
				documentID, ticketID, source.URL, actorUserID).Scan(&id); err != nil {
				return err
			}
			if err := rewriteChunksWithin(ctx, tx, company, id, article.Title, article.Body); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return nil
	})
	return ids, outcome, err
}

// sourceColumnsWithin turns a source into its columns. found=false: the
// document is gone (it is locked FOR KEY SHARE while the articles are saved).
func sourceColumnsWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, source Source) (documentID, ticketID *string, found bool, err error) {
	switch {
	case source.TicketNumber > 0:
		var id string
		err := tx.QueryRow(ctx, `SELECT id FROM tickets WHERE company_id = $1 AND ticket_number = $2 AND status = 'solved'`, company.String(), source.TicketNumber).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, true, nil
		}
		return nil, &id, err == nil, err
	case source.DocumentID != "":
		var id string
		err := tx.QueryRow(ctx, `SELECT id FROM company_documents WHERE company_id = $1 AND id::text = $2 FOR KEY SHARE`, company.String(), source.DocumentID).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, false, nil
		}
		return &id, nil, err == nil, err
	}
	return nil, nil, true, nil
}

// Edit saves a person's edit when they may make it and nobody changed the
// article since the revision they opened ("stale" otherwise: nobody
// overwrites words they didn't see). An approved article stays approved, in
// the editor's name. Nothing different = "unchanged". Also "not-found",
// "not-allowed", "changed".
func Edit(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, articleID string, revision int, fields Fields) (string, error) {
	outcome := "changed"
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil {
			return err
		}
		var current Fields
		var status string
		var stored int
		const read = `
			SELECT status, revision, title, body, kind, use_for_support, use_for_marketing FROM knowledge_articles
			WHERE company_id = $1 AND id::text = $2 FOR UPDATE`
		err = tx.QueryRow(ctx, read, company.String(), articleID).Scan(&status, &stored, &current.Title, &current.Body, &current.Kind, &current.UseForSupport, &current.UseForMarketing)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			outcome = "not-found"
			return nil
		case err != nil:
			return err
		case role == "" || !CanEdit(role, status):
			outcome = "not-allowed"
			return nil
		case stored != revision:
			outcome = "stale"
			return nil
		case current == fields:
			outcome = "unchanged"
			return nil
		}
		const update = `
			UPDATE knowledge_articles SET title = $3, body = $4, kind = $5, use_for_support = $6, use_for_marketing = $7,
				revision = revision + 1, updated_by_user_id = $8, updated_at = now(),
				approved_by_user_id = CASE WHEN status = 'approved' THEN $8::text ELSE approved_by_user_id END,
				approved_at = CASE WHEN status = 'approved' THEN now() ELSE approved_at END
			WHERE company_id = $1 AND id::text = $2`
		if _, err := tx.Exec(ctx, update, company.String(), articleID, fields.Title, fields.Body, fields.Kind, fields.UseForSupport, fields.UseForMarketing, actorUserID); err != nil {
			return err
		}
		if fields.Title == current.Title && fields.Body == current.Body {
			return nil
		}
		return rewriteChunksWithin(ctx, tx, company, articleID, fields.Title, fields.Body)
	})
	return outcome, err
}

// The statuses each owner's change starts from, and where it leads.
var changes = map[string]struct {
	from []string
	to   string
}{
	"approve": {[]string{"draft"}, "approved"},
	"archive": {[]string{"draft", "approved"}, "archived"},
	"restore": {[]string{"archived"}, "draft"},
}

// ChangeStatus approves, archives or restores one article (owners only).
// Approving names the revision the owner read ("stale" when changed
// since). Already there = "unchanged"; a status the change can't start from
// (another owner changed it meanwhile) = "wrong-status". Approving records
// who and when; restoring clears it (a draft carries no approval).
func ChangeStatus(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, articleID, change string, revision int) (string, error) {
	rule, known := changes[change]
	if !known {
		return "not-allowed", nil
	}
	outcome := "changed"
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil {
			return err
		}
		var status string
		var stored int
		err = tx.QueryRow(ctx, `SELECT status, revision FROM knowledge_articles WHERE company_id = $1 AND id::text = $2 FOR UPDATE`, company.String(), articleID).Scan(&status, &stored)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			outcome = "not-found"
			return nil
		case err != nil:
			return err
		case role != "owner":
			outcome = "not-allowed"
			return nil
		case status == rule.to:
			outcome = "unchanged"
			return nil
		case !contains(rule.from, status):
			outcome = "wrong-status"
			return nil
		case change == "approve" && stored != revision:
			outcome = "stale"
			return nil
		}
		const update = `
			UPDATE knowledge_articles SET status = $3, updated_by_user_id = $4, updated_at = now(),
				approved_by_user_id = CASE WHEN $5 = 'approve' THEN $4::text WHEN $5 = 'restore' THEN NULL ELSE approved_by_user_id END,
				approved_at = CASE WHEN $5 = 'approve' THEN now() WHEN $5 = 'restore' THEN NULL ELSE approved_at END
			WHERE company_id = $1 AND id::text = $2`
		_, err = tx.Exec(ctx, update, company.String(), articleID, rule.to, actorUserID, change)
		return err
	})
	return outcome, err
}

// Delete deletes one article and (ON DELETE CASCADE) its pieces, for good
// (owners only; archiving keeps it instead). "deleted", "not-found" or
// "not-allowed".
func Delete(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, articleID string) (string, error) {
	outcome := "deleted"
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role != "owner" {
			outcome = "not-allowed"
			return err
		}
		tag, err := tx.Exec(ctx, `DELETE FROM knowledge_articles WHERE company_id = $1 AND id::text = $2`, company.String(), articleID)
		if err == nil && tag.RowsAffected() == 0 {
			outcome = "not-found"
		}
		return err
	})
	return outcome, err
}

// rewriteChunksWithin rewrites an article's pieces in the transaction that
// changed its title or body (search_vector is made by Postgres).
func rewriteChunksWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, articleID, title, body string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM knowledge_chunks WHERE company_id = $1 AND article_id = $2`, company.String(), articleID); err != nil {
		return err
	}
	const insert = `INSERT INTO knowledge_chunks (company_id, article_id, position, heading, text) VALUES ($1, $2, $3, $4, $5)`
	for position, text := range ChunkBody(body) {
		if _, err := tx.Exec(ctx, insert, company.String(), articleID, position, title, text); err != nil {
			return err
		}
	}
	return nil
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
