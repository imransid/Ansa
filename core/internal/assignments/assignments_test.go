package assignments

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/email"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
	"ansa/core/internal/tickets"
)

func TestTheExpertRoutingPicksIsEmailedOnceWithoutCustomerDetails(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	ctx := context.Background()
	expert := database.TestOwner(t, pool, companyID)
	var categoryID string
	pool.QueryRow(ctx, `INSERT INTO categories (company_id, name) VALUES ($1, 'Complaints') RETURNING id`, companyID).Scan(&categoryID)
	pool.Exec(ctx, `INSERT INTO user_categories (company_id, user_id, category_id) VALUES ($1, $2, $3)`, companyID, expert, categoryID)
	messageID, _ := conversations.NewID()
	turn, _ := conversations.InsertCustomerMessage(ctx, pool, company, conversations.ContactKey{Channel: conversations.ChannelStandIn, ExternalID: "as"}, conversations.IncomingMessage{ID: messageID, BodyEncrypted: "v1:x:y:z", ChannelMessageID: "as1"})
	name := "Ana Customer"
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		_, err := tickets.CreateChatTicketWithin(ctx, tx, company, tickets.NewChatTicket{Subject: "Cold\npizza", Description: "They complained.", CategoryID: categoryID, CustomerName: &name, ConversationID: turn.ConversationID})
		return err
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	var job jobs.Job
	var companyText string
	if err := pool.QueryRow(ctx, `SELECT id, company_id, kind, payload FROM core_jobs WHERE company_id = $1 AND kind = $2`, companyID, tickets.AssignedJobKind).Scan(&job.ID, &companyText, &job.Kind, &job.Payload); err != nil {
		t.Fatalf("the routing queued the email: %v", err)
	}
	job.CompanyID = company
	folder := t.TempDir()
	notifier := &Notifier{Pool: pool, Email: &email.Sender{DevFolder: folder}, AppURL: "http://localhost:3000", Log: logging.New(io.Discard)}
	if err := notifier.HandleJob(ctx, &job); err != nil {
		t.Fatalf("HandleJob: %v", err)
	}
	files, _ := os.ReadDir(filepath.Join(folder, ".dev-emails"))
	if len(files) != 1 {
		t.Fatalf("one email: %d", len(files))
	}
	page, _ := os.ReadFile(filepath.Join(folder, ".dev-emails", files[0].Name()))
	if !strings.Contains(string(page), "Request #1 is yours: Cold pizza") || !strings.Contains(string(page), "because you handle Complaints") || strings.Contains(string(page), "Ana Customer") {
		t.Fatalf("the email: number, subject and category only")
	}
	pool.Exec(ctx, `UPDATE users SET deactivated_at = now() WHERE company_id = $1 AND id = $2`, companyID, expert)
	notifier.HandleJob(ctx, &job)
	if files, _ := os.ReadDir(filepath.Join(folder, ".dev-emails")); len(files) != 1 {
		t.Fatal("someone removed hears nothing more")
	}
}
