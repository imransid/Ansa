package billing

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"ansa/core/internal/database"
	"ansa/core/internal/httpserver"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/tenant"
)

// Stripe's webhook: 600 a minute per IP (a ceiling), at most 256 KB.
var webhookPerIP = ratelimit.Rule{MaxAttempts: 600, Window: time.Minute}

const webhookMaxBytes = 256 << 10

var uuidShape = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// Webhook is POST /webhooks/stripe. LOGGING RULE: fixed lines only, never
// ids, emails, the body or Stripe's words.
type Webhook struct {
	Pool    *database.Pool
	Limiter *ratelimit.Limiter
	Log     *logging.Logger
	// STRIPE_WEBHOOK_SECRET ("": every request is refused).
	Secret string
	Stripe interface {
		Subscription(ctx context.Context, id string) (Retrieved, error)
	}
}

// ServeHTTP runs the same order as every webhook: size cap, raw bytes,
// Stripe's signature and time, the per-IP limit, then JSON. Answers 500
// when Stripe should try again later (its API didn't answer).
func (h *Webhook) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, err := httpserver.ReadBody(r, webhookMaxBytes)
	if err == httpserver.ErrTooLarge {
		h.Log.Warn("stripe webhook rejected", logging.Code("too_large"))
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		return
	}
	if err != nil || !SignedByStripe(body, r.Header.Get("Stripe-Signature"), h.Secret, time.Now()) {
		h.Log.Warn("stripe webhook rejected", logging.Code("invalid_signature"))
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if over, err := h.Limiter.Over(r.Context(), "stripe-webhook", httpserver.ClientIP(r), webhookPerIP); err != nil || over {
		h.Log.Warn("stripe webhook rejected", logging.Code("rate_limited"))
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}
	subscriptionID, checkoutCompany, ok := target(body)
	if !ok {
		// Every other event is acknowledged and ignored.
		w.WriteHeader(http.StatusOK)
		return
	}
	retrieved, err := h.Stripe.Subscription(r.Context(), subscriptionID)
	if err != nil {
		h.Log.Error("stripe webhook failed", logging.Code("stripe_unavailable"))
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	if err := h.saveForItsCompany(r.Context(), checkoutCompany, retrieved); err != nil {
		h.Log.Error("stripe webhook failed", logging.ErrorType(err))
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// target is which subscription an event is about, and for a finished
// checkout the company our checkout named (client_reference_id).
func target(body []byte) (subscriptionID, checkoutCompany string, ok bool) {
	var event struct {
		Type string `json:"type"`
		Data struct {
			Object struct {
				ID                string `json:"id"`
				Mode              string `json:"mode"`
				ClientReferenceID string `json:"client_reference_id"`
				Subscription      string `json:"subscription"`
			} `json:"object"`
		} `json:"data"`
	}
	if json.Unmarshal(body, &event) != nil || len(event.Type) > 100 {
		return "", "", false
	}
	object := event.Data.Object
	switch event.Type {
	case "checkout.session.completed":
		if object.Mode != "subscription" || !uuidShape.MatchString(object.ClientReferenceID) || !isSubscriptionID(object.Subscription) {
			return "", "", false
		}
		return object.Subscription, object.ClientReferenceID, true
	case "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted":
		return object.ID, "", isSubscriptionID(object.ID)
	}
	return "", "", false
}

func isSubscriptionID(id string) bool {
	return strings.HasPrefix(id, "sub_") && len(id) <= 255
}

// saveForItsCompany stores the subscription for its company, or ignores it
// with a fixed line (answered 200 either way: a retry changes nothing).
func (h *Webhook) saveForItsCompany(ctx context.Context, checkoutCompany string, retrieved Retrieved) error {
	owner, err := companyOfCustomer(ctx, h.Pool, retrieved.Snapshot.CustomerID)
	if err != nil {
		return err
	}
	companyText, ignored := chooseCompany(checkoutCompany, retrieved.MetadataCompanyID, owner)
	if ignored != "" {
		h.Log.Warn("stripe webhook ignored", logging.Code(ignored))
		return nil
	}
	company, err := tenant.FromTrustedSource(companyText)
	if err != nil {
		return err
	}
	if retrieved.Snapshot.Package == "" {
		// A price none of ansa's packages has (one changed in Stripe's dashboard).
		h.Log.Error("stripe webhook ignored: the subscription's price is no package's", logging.Code("unknown_price"))
		return nil
	}
	saved, err := Save(ctx, h.Pool, company, retrieved.Snapshot)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && (pgErr.Code == "23503" || pgErr.Code == "23505") {
		// An unknown company, or a customer or subscription stored for another
		// company: billing never moves between companies.
		h.Log.Warn("stripe webhook ignored", logging.Code("company_mismatch"))
		return nil
	}
	if err == nil && !saved && IsLive(retrieved.Snapshot.Status) {
		// The owner paid twice: Stripe now bills two subscriptions, one stored.
		// A person cancels the other in Stripe's dashboard.
		h.Log.Error("stripe webhook ignored: company already has another live subscription", logging.Code("second_subscription"))
	}
	return err
}

// chooseCompany says which company a subscription is for (the old rules):
// only a finished checkout gives a company its first billing row (a
// subscription event about a customer no company owns yet is ignored: its
// metadata alone could name any company); the checkout and the metadata
// disagreeing stores nothing; later events go to the company that owns the
// customer, never to another.
func chooseCompany(checkoutCompany, metadataCompany, customerOwner string) (string, string) {
	if checkoutCompany == "" && customerOwner == "" {
		return "", "customer_not_known_yet"
	}
	if checkoutCompany != "" && metadataCompany != "" && checkoutCompany != metadataCompany {
		return "", "checkout_and_subscription_disagree"
	}
	company := checkoutCompany
	if company == "" {
		company = metadataCompany
	}
	if company == "" {
		company = customerOwner
	}
	if !uuidShape.MatchString(company) {
		return "", "no_company_on_subscription"
	}
	if customerOwner != "" && customerOwner != company {
		return "", "customer_belongs_to_another_company"
	}
	return company, ""
}
