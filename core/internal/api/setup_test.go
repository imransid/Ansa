package api

import (
	"context"
	"testing"
)

func TestTheSetupStepByStep(t *testing.T) {
	w := newAPIWorld(t)
	ctx := context.Background()
	code, answer := w.call("POST", "/api/v1/setup/business?from=setup", `{"kind":"business","companyName":"L","businessType":"spaceship","description":""}`, screensSecret, w.cookie)
	fields, _ := answer["fields"].(map[string]any)
	if code != 400 || fields["companyName"] == nil || fields["businessType"] != "Choose what kind of business it is." || fields["description"] != "Say in a sentence what you serve." {
		t.Fatalf("step 1's problems: %d %v", code, answer)
	}
	code, answer = w.call("POST", "/api/v1/setup/business?from=setup", `{"kind":"business","companyName":"Luigi's","businessType":"restaurant","description":"Pizza by the slice"}`, screensSecret, w.cookie)
	if code != 200 || answer["nextStep"] != "contact" {
		t.Fatalf("step 1: %d %v", code, answer)
	}
	if code, answer := w.call("POST", "/api/v1/setup/contact?from=setup", `{"address":"Via Roma 1","phone":"+39 051 123"}`, screensSecret, w.cookie); code != 200 || answer["nextStep"] != "hours" {
		t.Fatalf("step 2: %d %v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/setup/hours?from=setup", `{"timeZone":"Europe/Rome","hours":{"tue":[{"opens":"18:00","closes":"00:00"}]}}`, screensSecret, w.cookie); code != 200 {
		t.Fatal("step 3")
	}
	if code, answer := w.call("POST", "/api/v1/setup/orders?from=setup", `{"takesOrders":true,"delivery":true,"deliveryNote":"","deliveryFee":"2,5","pickup":true,"paymentNote":"Cash","currency":"XYZ"}`, screensSecret, w.cookie); code != 400 || answer["fields"].(map[string]any)["currency"] == nil {
		t.Fatalf("an unknown currency: %d %v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/setup/orders?from=setup", `{"takesOrders":true,"delivery":true,"deliveryNote":"","deliveryFee":"2,5","pickup":true,"paymentNote":"Cash","currency":"EUR"}`, screensSecret, w.cookie); code != 200 {
		t.Fatal("step 4")
	}
	if code, answer := w.call("POST", "/api/v1/setup/finish", "", screensSecret, w.cookie); code != 409 {
		t.Fatalf("not finished before every step: %d %v", code, answer)
	}
	w.call("POST", "/api/v1/setup/assistant?from=setup", `{"instructions":"Be brief.","holdingReply":"One moment please."}`, screensSecret, w.cookie)
	w.call("POST", "/api/v1/setup/connect", "", screensSecret, w.cookie)
	if code, _ := w.call("POST", "/api/v1/setup/finish", "", screensSecret, w.cookie); code != 200 {
		t.Fatalf("finished: %d", code)
	}
	code, answer = w.call("GET", "/api/v1/setup", "", screensSecret, w.cookie)
	profile := answer["profile"].(map[string]any)
	saved := profile["settings"].(map[string]any)
	if code != 200 || profile["setupFinished"] != true || profile["address"] != "Via Roma 1" || saved["deliveryFeeCents"] != 250.0 || saved["publicPhone"] != "+39 051 123" {
		t.Fatalf("the profile: %d %v", code, profile)
	}
	var fact string
	w.pool.QueryRow(ctx, `SELECT confirmed_value FROM business_facts WHERE company_id = $1 AND topic = 'company_name'`, w.company.String()).Scan(&fact)
	if fact != "Luigi's" {
		t.Fatal("the name is the owner's confirmed fact")
	}
	if code, answer := w.call("POST", "/api/v1/setup/business", `{"kind":"personal","companyName":"Rafa","businessType":null,"description":""}`, screensSecret, w.cookie); code != 200 || answer["nextStep"] != "away" {
		t.Fatalf("a person's next step: %d %v", code, answer)
	}
	var holding, answerWhen string
	w.pool.QueryRow(ctx, `SELECT holding_reply, answer_when FROM assistant_settings WHERE company_id = $1`, w.company.String()).Scan(&holding, &answerWhen)
	if holding != "One moment please." || answerWhen != "when_away" {
		t.Fatalf("an owner's own holding reply stays; a person answers only while away: %q %q", holding, answerWhen)
	}
}
