package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Stripe is ansa's Stripe account, spoken to over its REST API (no SDK):
// card details never touch ansa's servers, customers type them on Stripe's
// own pages. A test replaces BaseURL.
type Stripe struct {
	SecretKey, PriceID string
	BaseURL            string
}

// The API version the old backend's library (stripe 23.0.0) pinned: answers
// keep the shape the code reads (a period end on each subscription item).
const stripeVersion = "2026-09-30.endive"

var stripeClient = &http.Client{Timeout: 20 * time.Second}

// errStripe: Stripe refused or didn't answer (its words are never kept).
var errStripe = errors.New("billing: Stripe did not answer as expected")

func (s *Stripe) call(ctx context.Context, method, path string, form url.Values, into any) error {
	base := s.BaseURL
	if base == "" {
		base = "https://api.stripe.com"
	}
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	request, err := http.NewRequestWithContext(ctx, method, base+path, body)
	if err != nil {
		return err
	}
	request.SetBasicAuth(s.SecretKey, "")
	request.Header.Set("Stripe-Version", stripeVersion)
	if form != nil {
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	response, err := stripeClient.Do(request)
	if err != nil {
		return errStripe
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return errStripe
	}
	if json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(into) != nil {
		return errStripe
	}
	return nil
}

// CheckoutURL is a Stripe page where the owner subscribes to the plan. The
// company id goes in two places Stripe signs back (client_reference_id and
// the subscription's metadata): how the webhook knows which company paid.
// A company that paid before keeps its one Stripe customer.
func (s *Stripe) CheckoutURL(ctx context.Context, companyID, ownerEmail, customerID, successURL, cancelURL string) (string, error) {
	form := url.Values{
		"mode":                                   {"subscription"},
		"line_items[0][price]":                   {s.PriceID},
		"line_items[0][quantity]":                {"1"},
		"client_reference_id":                    {companyID},
		"subscription_data[metadata][companyId]": {companyID},
		"success_url":                            {successURL},
		"cancel_url":                             {cancelURL},
	}
	if customerID != "" {
		form.Set("customer", customerID)
	} else {
		form.Set("customer_email", ownerEmail)
	}
	var session struct {
		URL string `json:"url"`
	}
	if err := s.call(ctx, http.MethodPost, "/v1/checkout/sessions", form, &session); err != nil || !strings.HasPrefix(session.URL, "https://") {
		return "", errStripe
	}
	return session.URL, nil
}

// PortalURL is Stripe's page where the owner changes card, sees invoices or cancels.
func (s *Stripe) PortalURL(ctx context.Context, customerID, returnURL string) (string, error) {
	var session struct {
		URL string `json:"url"`
	}
	form := url.Values{"customer": {customerID}, "return_url": {returnURL}}
	if err := s.call(ctx, http.MethodPost, "/v1/billing_portal/sessions", form, &session); err != nil || !strings.HasPrefix(session.URL, "https://") {
		return "", errStripe
	}
	return session.URL, nil
}

// Retrieved is a subscription as Stripe has it NOW (webhooks can arrive
// late or out of order), and apart from it the company id in its metadata,
// so the metadata can never pick the company a row is written for.
type Retrieved struct {
	Snapshot          Snapshot
	MetadataCompanyID string
}

// Subscription reads one subscription from Stripe.
func (s *Stripe) Subscription(ctx context.Context, subscriptionID string) (Retrieved, error) {
	var answer struct {
		ID                string            `json:"id"`
		Status            string            `json:"status"`
		CancelAtPeriodEnd bool              `json:"cancel_at_period_end"`
		Metadata          map[string]string `json:"metadata"`
		Customer          json.RawMessage   `json:"customer"`
		Items             struct {
			Data []struct {
				CurrentPeriodEnd int64 `json:"current_period_end"`
			} `json:"data"`
		} `json:"items"`
	}
	if err := s.call(ctx, http.MethodGet, "/v1/subscriptions/"+url.PathEscape(subscriptionID), nil, &answer); err != nil {
		return Retrieved{}, err
	}
	customer := ""
	if json.Unmarshal(answer.Customer, &customer) != nil {
		var expanded struct {
			ID string `json:"id"`
		}
		json.Unmarshal(answer.Customer, &expanded)
		customer = expanded.ID
	}
	if customer == "" || answer.ID == "" {
		return Retrieved{}, errStripe
	}
	snapshot := Snapshot{CustomerID: customer, SubscriptionID: answer.ID, Status: ourStatus(answer.Status), CancelAtPeriodEnd: answer.CancelAtPeriodEnd}
	if len(answer.Items.Data) > 0 && answer.Items.Data[0].CurrentPeriodEnd > 0 {
		end := time.Unix(answer.Items.Data[0].CurrentPeriodEnd, 0).UTC()
		snapshot.CurrentPeriodEnd = &end
	}
	return Retrieved{Snapshot: snapshot, MetadataCompanyID: answer.Metadata["companyId"]}, nil
}

// statuses are the ones the table knows (a status Stripe adds later counts as not paying).
var statuses = map[string]bool{"trialing": true, "active": true, "past_due": true, "unpaid": true, "paused": true, "incomplete": true, "incomplete_expired": true, "canceled": true}

func ourStatus(status string) string {
	if statuses[status] {
		return status
	}
	return "incomplete"
}

// SignedByStripe checks Stripe's signature header ("t=<time>,v1=<hex>,...")
// on these exact bytes: HMAC-SHA256 of "<t>.<body>" with the webhook's
// secret, made in the last 5 minutes (the signed time stops replays).
// Parses nothing else, compared in constant time.
func SignedByStripe(body []byte, header, secret string, now time.Time) bool {
	if secret == "" {
		return false
	}
	var timestamp string
	var signatures []string
	for _, part := range strings.Split(header, ",") {
		key, value, _ := strings.Cut(strings.TrimSpace(part), "=")
		switch key {
		case "t":
			timestamp = value
		case "v1":
			signatures = append(signatures, value)
		}
	}
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || now.Sub(time.Unix(seconds, 0)).Abs() > 5*time.Minute {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "."))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	for _, signature := range signatures {
		if hmac.Equal([]byte(signature), []byte(expected)) {
			return true
		}
	}
	return false
}
