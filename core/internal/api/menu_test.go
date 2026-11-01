package api

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/menu"
	"ansa/core/internal/ratelimit"
)

func TestTheMenuThroughCoresAPI(t *testing.T) {
	w := newAPIWorld(t)
	if code, answer := w.call("POST", "/api/v1/menu/items", `{"category":"Pizza","name":"Margherita","description":"","price":"9.50"}`, screensSecret, w.cookie); code != 400 || !strings.Contains(answer["error"].(string), "currency") {
		t.Fatalf("no menu before a currency: %d %v", code, answer)
	}
	w.must(`INSERT INTO assistant_settings (company_id, currency, time_zone) VALUES ($1, 'EUR', 'Europe/Rome')`, w.company.String())
	if code, answer := w.call("POST", "/api/v1/menu/items", `{"category":"Pizza","name":"","description":"","price":"9,99,9"}`, screensSecret, w.cookie); code != 400 ||
		answer["fields"].(map[string]any)["name"] != "Give the dish a name." || answer["fields"].(map[string]any)["price"] != "Write a price like 9.50." {
		t.Fatalf("a dish's problems: %d %v", code, answer)
	}
	for _, dish := range []string{`{"category":"Pizza","name":"Margherita","description":"","price":"9,5"}`, `{"category":"Pizza","name":"Diavola","description":"Hot","price":"11"}`} {
		if code, _ := w.call("POST", "/api/v1/menu/items", dish, screensSecret, w.cookie); code != 200 {
			t.Fatalf("added: %d", code)
		}
	}
	_, answer := w.call("GET", "/api/v1/menu", "", screensSecret, w.cookie)
	items := answer["items"].([]any)
	second := items[1].(map[string]any)
	if len(items) != 2 || items[0].(map[string]any)["priceCents"] != 950.0 || second["name"] != "Diavola" {
		t.Fatalf("the menu: %v", answer)
	}
	id := second["id"].(string)
	w.call("POST", "/api/v1/menu/items/"+id+"/move", `{"direction":"up"}`, screensSecret, w.cookie)
	w.call("POST", "/api/v1/menu/items/"+id+"/availability", `{"available":false}`, screensSecret, w.cookie)
	_, answer = w.call("GET", "/api/v1/menu", "", screensSecret, w.cookie)
	first := answer["items"].([]any)[0].(map[string]any)
	if first["name"] != "Diavola" || first["available"] != false {
		t.Fatalf("moved up and not available today: %v", first)
	}
	code, answer := w.call("POST", "/api/v1/menu/reading/confirm", `{"items":[{"category":"","name":"Water","description":"","price":"2"},{"category":"","name":"Wine","description":"","price":"cheap"}]}`, screensSecret, w.cookie)
	if code != 400 || answer["error"] != "Dish 2 (Wine): write a price like 9.50." {
		t.Fatalf("a reading names its dish: %d %v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/menu/items/"+id+"/delete", "", screensSecret, w.cookie); code != 200 {
		t.Fatal("deleted")
	}
	if code, _ := w.call("POST", "/api/v1/menu/items/"+id+"/delete", "", screensSecret, w.cookie); code != 404 {
		t.Fatal("deleted already: 404")
	}
	var count int
	w.pool.QueryRow(context.Background(), `SELECT count(*) FROM catalog_items WHERE company_id = $1`, w.company.String()).Scan(&count)
	if count != 1 {
		t.Fatalf("a refused reading adds nothing: %d", count)
	}
}

func TestNotAvailableTodayEndsAtTheBusinesssMidnight(t *testing.T) {
	rome, _ := time.LoadLocation("Europe/Rome")
	// 23:30 in Rome on the night clocks go back (2026-10-25 is that Sunday, so take the 24th).
	now := time.Date(2026, 10, 24, 21, 30, 0, 0, time.UTC)
	end := menu.EndOfLocalDay(rome, now)
	if got := end.In(rome).Format("2006-01-02 15:04"); got != "2026-10-25 00:00" {
		t.Fatalf("the next midnight in Rome: %s", got)
	}
}

func TestReadingAMenuSavesNothing(t *testing.T) {
	w := newAPIWorld(t)
	w.must(`INSERT INTO assistant_settings (company_id, currency) VALUES ($1, 'EUR')`, w.company.String())
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		io.WriteString(rw, `{"kind":"stand_in","rows":[{"category":"Pizzas","name":"Margherita","description":"","price":"9.50"}]}`)
	}))
	defer brain.Close()
	w.serverAPI().MenuBrain = brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second)
	t.Cleanup(func() {
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, ratelimit.New(w.pool, authSecret).Key("menu-readings", w.company.String()))
	})
	if code, answer := w.call("POST", "/api/v1/menu/read", `{"fileName":"menu.jpg","data":"`+base64.StdEncoding.EncodeToString([]byte("<svg>"))+`"}`, screensSecret, w.cookie); code != 400 || !strings.Contains(answer["error"].(string), "Upload a photo") {
		t.Fatalf("not a photo: %d %v", code, answer)
	}
	code, answer := w.call("POST", "/api/v1/menu/read", `{"text":"Margherita 9.50"}`, screensSecret, w.cookie)
	items, _ := answer["items"].([]any)
	if code != 200 || len(items) != 1 || answer["standIn"] != true || items[0].(map[string]any)["priceCents"] != 950.0 {
		t.Fatalf("read: %d %v", code, answer)
	}
	if w.count(`SELECT count(*) FROM catalog_items WHERE company_id = $1`) != 0 {
		t.Fatal("reading saves nothing")
	}
}
