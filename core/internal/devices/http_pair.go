package devices

import (
	"net/http"
	"time"

	"ansa/core/internal/httpserver"
	"ansa/core/internal/logging"
)

// pair: POST /device/v1/pair {"code", "name", "platform"} -> {"token",
// "deviceId", "status"}. Checks, in this order: the body's size, the
// per-IP limit (before anything is read: guessing codes costs tries), the
// body read strictly, then the code claimed with the phone saved.
func (a *API) pair(w http.ResponseWriter, r *http.Request) {
	body, err := httpserver.ReadBody(r, maxBodyBytes)
	if err == httpserver.ErrTooLarge {
		problem(w, http.StatusRequestEntityTooLarge, requestTooLarge)
		return
	}
	if err != nil {
		problem(w, http.StatusBadRequest, badRequestText)
		return
	}
	if over, err := a.Limiter.Over(r.Context(), "device-pair", httpserver.ClientIP(r), pairLimit); err != nil || over {
		a.Log.Warn("devices: pairing refused", logging.Code("rate_limited"))
		problem(w, http.StatusTooManyRequests, tooManyText)
		return
	}
	var input struct {
		Code     string `json:"code"`
		Name     string `json:"name"`
		Platform string `json:"platform"`
	}
	if !readJSON(body, &input) || !PlatformKnown(input.Platform) || CleanName(input.Name) == "" {
		problem(w, http.StatusBadRequest, badRequestText)
		return
	}
	code, shaped := NormalizeCode(input.Code)
	if !shaped {
		problem(w, http.StatusBadRequest, wrongCodeText)
		return
	}
	pairing, err := Pair(r.Context(), a.Pool, code, NewPhone{Name: CleanName(input.Name), Platform: input.Platform})
	switch {
	case err != nil:
		a.failed(w, "pairing", err)
		return
	case pairing.Outcome == TooManyPhones:
		problem(w, http.StatusConflict, tooManyPhonesText)
		return
	case pairing.Outcome != Paired:
		a.Log.Warn("devices: pairing refused", logging.Code("wrong_code"))
		problem(w, http.StatusBadRequest, wrongCodeText)
		return
	}
	status, err := ReadStatus(r.Context(), a.Pool, pairing.Device.Company, time.Now())
	if err != nil {
		a.failed(w, "status", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": pairing.Token, "deviceId": pairing.Device.ID, "status": status})
}
