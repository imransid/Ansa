package alerts

import (
	"context"
	"encoding/json"
	"html"
	"strconv"
	"strings"

	"ansa/core/internal/assistant"
	"ansa/core/internal/database"
	"ansa/core/internal/email"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/money"
	"ansa/core/internal/telegram"
	"ansa/core/internal/tenant"
)

// HandleOrderJob runs the "order.alert" job: the owners are told a customer
// placed an order (the old services/order-alerts.ts): its number, who,
// where and ansa's total, with a link to the Orders page. Never the dishes,
// the address or the customer's messages.
func (a *Alerter) HandleOrderJob(ctx context.Context, job *jobs.Job) error {
	var payload assistant.OrderAlertPayload
	if json.Unmarshal(job.Payload, &payload) != nil || payload.OrderID == "" {
		return &jobs.Failure{Code: "bad_payload", Permanent: true}
	}
	over, err := a.Limiter.Over(ctx, "owner-alerts", job.CompanyID.String(), alertLimit)
	if err != nil || over {
		if over {
			a.Log.Warn("alerts: skipped, hourly limit")
		}
		return err
	}
	order, err := readPlacedOrder(ctx, a.Pool, job.CompanyID, payload.OrderID)
	if err != nil {
		return err
	}
	details, err := readDetails(ctx, a.Pool, job.CompanyID, assistant.AlertPayload{ConversationID: order.ConversationID})
	if err != nil {
		return err
	}
	alert := NewOrder{Number: order.Number, Total: money.Format(order.TotalCents, order.Currency), CustomerName: details.CustomerName,
		ChannelLabel: assistant.ChannelLabels[details.Channel], Link: a.AppURL + "/orders"}
	if details.AlertByEmail {
		for _, owner := range details.Owners {
			rendered := alert.Email(owner.Name)
			result := a.Email.Send(ctx, email.Message{From: a.Email.FromHeader(details.CompanyName), To: owner.Email, Subject: rendered.Subject,
				HTML: rendered.HTML, Text: rendered.Text, IdempotencyKey: "new-order-" + payload.OrderID + "-" + owner.ID})
			if !result.OK {
				a.Log.Warn("alerts: email not sent", logging.Code(result.Error))
			}
		}
	}
	if a.TelegramToken != "" && details.TelegramChatID != "" {
		if result := telegram.Send(ctx, a.TelegramToken, details.TelegramChatID, alert.TelegramNote(), ""); result.Status != "sent" {
			a.Log.Warn("alerts: telegram note not sent", logging.Code(result.Error))
		}
	}
	return nil
}

type placedOrder struct {
	ConversationID, Currency string
	Number                   int
	TotalCents               int64
}

func readPlacedOrder(ctx context.Context, pool *database.Pool, company tenant.CompanyID, orderID string) (placedOrder, error) {
	const statement = `
		SELECT conversation_id, currency, order_number, total_cents FROM orders
		WHERE company_id = $1 AND id = $2 AND order_number IS NOT NULL`
	var o placedOrder
	err := pool.QueryRow(ctx, statement, company.String(), orderID).Scan(&o.ConversationID, &o.Currency, &o.Number, &o.TotalCents)
	return o, err
}

// NewOrder is one new-order alert (the old lib/emails/new-order.ts).
type NewOrder struct {
	Number             int
	Total              string
	CustomerName       *string
	ChannelLabel, Link string
}

func (n NewOrder) customer() string {
	return NeedsYou{CustomerName: n.CustomerName}.customer()
}

// Email is the alert for one owner.
func (n NewOrder) Email(ownerName string) Rendered {
	number := "#" + strconv.Itoa(n.Number)
	customer := n.customer()
	subject := []rune("New order " + number + " from " + customer)
	if len(subject) > 150 {
		subject = subject[:150]
	}
	text := strings.Join([]string{"Hi " + ownerName + ",", "", customer + " placed order " + number + " on " + n.ChannelLabel + ": " + n.Total + ".", "", "Accept it on the Orders page: " + n.Link}, "\n")
	page := `<!doctype html>
<html>
  <body style="font-family: sans-serif; line-height: 1.5; color: #111;">
    <p>Hi ` + html.EscapeString(ownerName) + `,</p>
    <p><strong>` + html.EscapeString(customer) + `</strong> placed order ` + number + ` on ` + html.EscapeString(n.ChannelLabel) + `: ` + html.EscapeString(n.Total) + `.</p>
    <p><a href="` + html.EscapeString(n.Link) + `">Accept it on the Orders page</a></p>
  </body>
</html>`
	return Rendered{Subject: string(subject), HTML: page, Text: text}
}

// TelegramNote is the same alert as one short message from ansa's bot.
func (n NewOrder) TelegramNote() string {
	return "New order #" + strconv.Itoa(n.Number) + " from " + n.customer() + " on " + n.ChannelLabel + ": " + n.Total + ". Accept it: " + n.Link
}
