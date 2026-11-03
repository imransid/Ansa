package whatsapp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"slices"
)

// Signup is what Meta's sign-up window reported: its one-time code (it
// works for 30 seconds) and the business account and number the business
// chose. All three are the browser's claims until Meta confirms them.
type Signup struct {
	Code, WABAID, PhoneNumberID string
}

// VerifiedNumber is what Meta confirmed, with the business's token.
type VerifiedNumber struct {
	WABAID, PhoneNumberID, DisplayPhoneNumber, VerifiedName string
	// The number is also in use in the WhatsApp Business app (coexistence).
	SharedWithApp bool
	Token         string
}

// Why Meta didn't confirm a sign-up (the page words each code).
const (
	SignupCodeRefused     = "code_refused"
	SignupNotGranted      = "not_granted"
	SignupNumberUnknown   = "number_unknown"
	SignupSubscribeFailed = "subscribe_failed"
	SignupRegisterFailed  = "register_failed"
	SignupNoAnswer        = "no_answer"
)

// SignupError says why, as one of the codes above.
type SignupError struct{ Code string }

func (e *SignupError) Error() string { return "whatsapp: sign-up not confirmed: " + e.Code }

// Confirm checks a sign-up with Meta, server to server, before anything is
// saved: the code exchanged for the business's token; the token ansa's
// app's, valid, and reaching that business account; the number one of the
// account's (with Meta's own word on whether the WhatsApp Business app
// uses it); ansa's app subscribed to the account's webhooks; and a number
// not shared with the app registered for the Cloud API.
func Confirm(ctx context.Context, appID, appSecret string, signup Signup) (VerifiedNumber, error) {
	if !metaID.MatchString(signup.WABAID) || !metaID.MatchString(signup.PhoneNumberID) {
		return VerifiedNumber{}, &SignupError{Code: SignupNumberUnknown}
	}
	token, err := exchangeCode(ctx, appID, appSecret, signup.Code)
	if err != nil {
		return VerifiedNumber{}, err
	}
	if err := checkToken(ctx, appID, appSecret, token, signup.WABAID); err != nil {
		return VerifiedNumber{}, err
	}
	number, err := readNumber(ctx, appSecret, token, signup.WABAID, signup.PhoneNumberID)
	if err != nil {
		return VerifiedNumber{}, err
	}
	if !graphSucceeded(ctx, http.MethodPost, "/"+signup.WABAID+"/subscribed_apps", appSecret, token, nil) {
		return VerifiedNumber{}, &SignupError{Code: SignupSubscribeFailed}
	}
	if !number.SharedWithApp {
		// The number's new two-step verification PIN: ansa never needs it
		// again (the business can change it in WhatsApp Manager).
		pin, err := randomPIN()
		if err != nil {
			return VerifiedNumber{}, err
		}
		body, _ := json.Marshal(map[string]string{"messaging_product": "whatsapp", "pin": pin})
		if !graphSucceeded(ctx, http.MethodPost, "/"+signup.PhoneNumberID+"/register", appSecret, token, body) {
			return VerifiedNumber{}, &SignupError{Code: SignupRegisterFailed}
		}
	}
	number.Token = token
	return number, nil
}

// exchangeCode turns the one-time code into the business's token.
func exchangeCode(ctx context.Context, appID, appSecret, code string) (string, error) {
	if code == "" || len(code) > 2_000 {
		return "", &SignupError{Code: SignupCodeRefused}
	}
	query := url.Values{"client_id": {appID}, "client_secret": {appSecret}, "code": {code}}
	var answer struct {
		AccessToken string `json:"access_token"`
	}
	status, err := getJSON(ctx, GraphURL+"/oauth/access_token?"+query.Encode(), &answer)
	switch {
	case err != nil:
		return "", &SignupError{Code: SignupNoAnswer}
	case status/100 != 2 || answer.AccessToken == "" || len(answer.AccessToken) > 4_000:
		return "", &SignupError{Code: SignupCodeRefused}
	}
	return answer.AccessToken, nil
}

// checkToken: ansa's app's token, valid, granted the WhatsApp messaging
// permission for exactly this business account (debug_token, with ansa's
// app token).
func checkToken(ctx context.Context, appID, appSecret, token, wabaID string) error {
	query := url.Values{"input_token": {token}, "access_token": {appID + "|" + appSecret}}
	var answer struct {
		Data struct {
			AppID          string `json:"app_id"`
			IsValid        bool   `json:"is_valid"`
			GranularScopes []struct {
				Scope     string   `json:"scope"`
				TargetIDs []string `json:"target_ids"`
			} `json:"granular_scopes"`
		} `json:"data"`
	}
	status, err := getJSON(ctx, GraphURL+"/debug_token?"+query.Encode(), &answer)
	if err != nil {
		return &SignupError{Code: SignupNoAnswer}
	}
	if status/100 != 2 || answer.Data.AppID != appID || !answer.Data.IsValid {
		return &SignupError{Code: SignupNotGranted}
	}
	for _, granted := range answer.Data.GranularScopes {
		if granted.Scope == "whatsapp_business_messaging" && slices.Contains(granted.TargetIDs, wabaID) {
			return nil
		}
	}
	return &SignupError{Code: SignupNotGranted}
}

// readNumber finds the number among the business account's, with what
// Meta says of it.
func readNumber(ctx context.Context, appSecret, token, wabaID, phoneNumberID string) (VerifiedNumber, error) {
	var answer struct {
		Data []struct {
			ID                 string `json:"id"`
			DisplayPhoneNumber string `json:"display_phone_number"`
			VerifiedName       string `json:"verified_name"`
			IsOnBizApp         bool   `json:"is_on_biz_app"`
		} `json:"data"`
	}
	path := "/" + wabaID + "/phone_numbers?fields=id,display_phone_number,verified_name,is_on_biz_app&limit=100"
	status, err := getJSONWithToken(ctx, path, appSecret, token, &answer)
	if err != nil {
		return VerifiedNumber{}, &SignupError{Code: SignupNoAnswer}
	}
	if status/100 == 2 {
		for _, found := range answer.Data {
			if found.ID == phoneNumberID {
				display := cutTo(cleanName(found.DisplayPhoneNumber), 40)
				if display == "" {
					display = "WhatsApp number"
				}
				return VerifiedNumber{WABAID: wabaID, PhoneNumberID: phoneNumberID, DisplayPhoneNumber: display,
					VerifiedName: cleanName(found.VerifiedName), SharedWithApp: found.IsOnBizApp}, nil
			}
		}
	}
	return VerifiedNumber{}, &SignupError{Code: SignupNumberUnknown}
}
