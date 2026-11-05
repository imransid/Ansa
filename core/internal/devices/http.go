package devices

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/httpserver"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/settings"
)

// The phone app's API (/device/v1/...): called by the app itself, not
// through the screens. JSON in and out; every call but pair carries
// "Authorization: Bearer <device token>". An error is {"error": "<words for
// a person>"}, and 401 means the token is unknown or the phone was removed
// (the app forgets it and shows its connect screen).

// The app sends tiny bodies.
const maxBodyBytes = 4 << 10

var (
	// One phone's calls: a ceiling (the app checks in every 30 seconds and
	// reads its main screen now and then: about 40 calls in 10 minutes).
	deviceCallLimit = ratelimit.Rule{MaxAttempts: 300, Window: 10 * time.Minute}
	// Pairing tries per IP: a code is 8 letters of 31 and lives 5 minutes,
	// so guessing one is hopeless at this pace.
	pairLimit = ratelimit.Rule{MaxAttempts: 20, Window: 10 * time.Minute}
	// "I'm away" and "I'm back": the owner's settings counter, as on the website.
	settingsChanges = ratelimit.Rule{MaxAttempts: 60, Window: 10 * time.Minute}
)

// The words the app shows for each refusal.
const (
	wrongCodeText     = "That code isn't right, or it has expired. Show a new one on ansa's website."
	notPairedText     = "This phone isn't connected to ansa any more. Connect it again from ansa's website."
	tooManyText       = "Too many tries. Wait a few minutes and try again."
	badRequestText    = "Something went wrong. Update the app and try again."
	failedText        = "Something went wrong on ansa's side. Try again in a minute."
	tooManyPhonesText = "This account already has 10 phones connected. Remove one on ansa's website first."
	onlyOwnersText    = "Only owners say when ansa answers."
	requestTooLarge   = "That request is too big."
)

// API serves the app's calls.
type API struct {
	Pool    *database.Pool
	Limiter *ratelimit.Limiter
	Log     *logging.Logger
}

// Register adds the app's routes (core's main address, and the
// development LAN listener, which serves only these: OnlyDeviceRoutes).
func (a *API) Register(routes *http.ServeMux) {
	routes.HandleFunc("POST /device/v1/pair", a.pair)
	routes.HandleFunc("POST /device/v1/heartbeat", a.withDevice(a.heartbeat))
	routes.HandleFunc("GET /device/v1/home", a.withDevice(a.home))
	routes.HandleFunc("POST /device/v1/away", a.withDevice(a.away))
	routes.HandleFunc("POST /device/v1/unpair", a.withDevice(a.unpair))
}

// OnlyDeviceRoutes is a router with the app's routes and nothing else.
func OnlyDeviceRoutes(a *API) *http.ServeMux {
	routes := http.NewServeMux()
	a.Register(routes)
	return routes
}

// deviceHandler is one of the app's calls: its body and the phone.
type deviceHandler func(w http.ResponseWriter, r *http.Request, body []byte, device Device)

// withDevice checks, in this order: the body's size, the token (by its
// hash), the phone's ceiling. Nothing is parsed before the token checked out.
func (a *API) withDevice(h deviceHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := httpserver.ReadBody(r, maxBodyBytes)
		if err == httpserver.ErrTooLarge {
			problem(w, http.StatusRequestEntityTooLarge, requestTooLarge)
			return
		}
		if err != nil {
			problem(w, http.StatusBadRequest, badRequestText)
			return
		}
		token, bearer := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !bearer {
			token = ""
		}
		device, err := Authenticate(r.Context(), a.Pool, token)
		if err != nil {
			a.failed(w, "auth", err)
			return
		}
		if device == nil {
			a.Log.Warn("devices: request refused", logging.Code("unknown_token"))
			problem(w, http.StatusUnauthorized, notPairedText)
			return
		}
		if over, err := a.Limiter.Over(r.Context(), "device-calls", device.ID, deviceCallLimit); err != nil || over {
			a.Log.Warn("devices: request refused", logging.Code("rate_limited"))
			problem(w, http.StatusTooManyRequests, tooManyText)
			return
		}
		h(w, r, body, *device)
	}
}

// heartbeat: POST /device/v1/heartbeat {} (the check-in) -> {"status"}.
func (a *API) heartbeat(w http.ResponseWriter, r *http.Request, body []byte, device Device) {
	if !readJSON(body, &struct{}{}) {
		problem(w, http.StatusBadRequest, badRequestText)
		return
	}
	connected, err := CheckIn(r.Context(), a.Pool, device)
	switch {
	case err != nil:
		a.failed(w, "check-in", err)
	case !connected:
		problem(w, http.StatusUnauthorized, notPairedText)
	default:
		a.answerStatus(w, r, device)
	}
}

// home: GET /device/v1/home -> {"status", "needsYou", "activity"}.
func (a *API) home(w http.ResponseWriter, r *http.Request, _ []byte, device Device) {
	page, err := ReadPhoneHome(r.Context(), a.Pool, device.Company, time.Now())
	if err != nil {
		a.failed(w, "home", err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// away: POST /device/v1/away {"away": bool}: the website Home's "I'm away"
// and "I'm back", as the owner who paired the phone (their own: the
// phone's check-ins never undo it).
func (a *API) away(w http.ResponseWriter, r *http.Request, body []byte, device Device) {
	var input struct {
		Away *bool `json:"away"`
	}
	if !readJSON(body, &input) || input.Away == nil {
		problem(w, http.StatusBadRequest, badRequestText)
		return
	}
	if over, err := a.Limiter.Over(r.Context(), "settings-changes", device.PairedByUserID, settingsChanges); err != nil || over {
		problem(w, http.StatusTooManyRequests, tooManyText)
		return
	}
	outcome, err := settings.SetAway(r.Context(), a.Pool, device.Company, device.PairedByUserID, *input.Away)
	switch {
	case err != nil:
		a.failed(w, "away", err)
	case outcome != settings.Saved:
		problem(w, http.StatusForbidden, onlyOwnersText)
	default:
		a.answerStatus(w, r, device)
	}
}

// unpair: POST /device/v1/unpair {} -> 204 (the app forgets itself).
func (a *API) unpair(w http.ResponseWriter, r *http.Request, body []byte, device Device) {
	if !readJSON(body, &struct{}{}) {
		problem(w, http.StatusBadRequest, badRequestText)
		return
	}
	if err := Unpair(r.Context(), a.Pool, device); err != nil {
		a.failed(w, "unpair", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// answerStatus answers {"status": ...} as it is now.
func (a *API) answerStatus(w http.ResponseWriter, r *http.Request, device Device) {
	status, err := ReadStatus(r.Context(), a.Pool, device.Company, time.Now())
	if err != nil {
		a.failed(w, "status", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]Status{"status": status})
}

// failed logs a failure by its class only and answers 500.
func (a *API) failed(w http.ResponseWriter, what string, err error) {
	a.Log.Error("devices: "+what+" failed", logging.ErrorType(err))
	problem(w, http.StatusInternalServerError, failedText)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}

func problem(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// readJSON reads a body strictly (the app is ansa's own: an unknown field
// is refused). An empty body counts as {}.
func readJSON(body []byte, into any) bool {
	if len(bytes.TrimSpace(body)) == 0 {
		body = []byte("{}")
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	return decoder.Decode(into) == nil
}
