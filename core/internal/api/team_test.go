package api

import (
	"context"
	"strings"
	"testing"

	"ansa/core/internal/database"
)

func TestTheTeamThroughCoresAPI(t *testing.T) {
	w := newAPIWorld(t)
	w.api.AppURL = "https://ansa.test"
	owner := w.ownerID()
	if code, answer := w.call("POST", "/api/v1/team/invites", `{"email":" .bad@@x ","role":"boss"}`, screensSecret, w.cookie); code != 400 ||
		answer["fields"].(map[string]any)["email"] != "Enter a valid email address" || answer["fields"].(map[string]any)["role"] != "Choose a role" {
		t.Fatalf("invite problems: %d %v", code, answer)
	}
	code, answer := w.call("POST", "/api/v1/team/invites", `{"email":"New.Person@Example.com","role":"member"}`, screensSecret, w.cookie)
	link, _ := answer["link"].(string)
	if code != 200 || !strings.HasPrefix(link, "https://ansa.test/invite#") {
		t.Fatalf("invite: %d %v", code, answer)
	}
	_, answer = w.call("GET", "/api/v1/team", "", screensSecret, w.cookie)
	team := answer["team"].(map[string]any)
	invites := team["invites"].([]any)
	if len(invites) != 1 || invites[0].(map[string]any)["email"] != "new.person@example.com" {
		t.Fatalf("the pending invite, lower-cased: %v", team)
	}
	if code, _ := w.call("POST", "/api/v1/team/categories", `{"name":"Orders\nand more"}`, screensSecret, w.cookie); code != 400 {
		t.Fatalf("a name with a line break: %d", code)
	}
	if code, _ := w.call("POST", "/api/v1/team/categories", `{"name":"Orders"}`, screensSecret, w.cookie); code != 200 {
		t.Fatalf("category: %d", code)
	}
	if code, _ := w.call("POST", "/api/v1/team/people/"+owner+"/remove", "", screensSecret, w.cookie); code != 409 {
		t.Fatalf("never yourself: %d", code)
	}
	other := database.TestOwner(t, w.pool, w.company.String())
	if code, _ := w.call("POST", "/api/v1/team/people/"+other+"/role", `{"role":"member"}`, screensSecret, w.cookie); code != 200 {
		t.Fatalf("demote: %d", code)
	}
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, w.company.String(), owner)
	_, answer = w.call("GET", "/api/v1/team", "", screensSecret, w.cookie)
	if len(answer["team"].(map[string]any)["invites"].([]any)) != 0 || answer["canManage"] != false {
		t.Fatal("members never see pending invites")
	}
	if code, _ := w.call("POST", "/api/v1/team/people/"+other+"/categories", `{"categoryIds":[]}`, screensSecret, w.cookie); code != 403 {
		t.Fatalf("a member sets only their own categories: %d", code)
	}
	if code, _ := w.call("POST", "/api/v1/team/people/"+owner+"/categories", `{"categoryIds":[]}`, screensSecret, w.cookie); code != 200 {
		t.Fatalf("their own: %d", code)
	}
}

// A person's id is 32 letters and digits in both cases (core's signup and
// Better Auth make them so): the Team page's buttons name it exactly.
func TestTheTeamPagesButtonsFindAPersonWhoseIDHasCapitals(t *testing.T) {
	w := newAPIWorld(t)
	ctx := context.Background()
	var teammate, categoryID string
	w.pool.QueryRow(ctx, `
		INSERT INTO users (id, company_id, role, name, email, email_verified)
		VALUES ('Id' || upper(substr(md5(random()::text), 1, 15)) || substr(md5(random()::text), 1, 15), $1, 'member', 'Mixed Case', gen_random_uuid()::text || '@core-test.example', true)
		RETURNING id`, w.company.String()).Scan(&teammate)
	w.pool.QueryRow(ctx, `INSERT INTO categories (company_id, name) VALUES ($1, 'Orders') RETURNING id`, w.company.String()).Scan(&categoryID)
	if strings.ToLower(teammate) == teammate {
		t.Fatalf("the test needs capitals in the id: %s", teammate)
	}
	people := "/api/v1/team/people/"
	if code, answer := w.call("POST", people+teammate+"/categories", `{"categoryIds":["`+categoryID+`"]}`, screensSecret, w.cookie); code != 200 {
		t.Fatalf("their categories: %d %v", code, answer)
	}
	var handled int
	w.pool.QueryRow(ctx, `SELECT count(*) FROM user_categories WHERE company_id = $1 AND user_id = $2`, w.company.String(), teammate).Scan(&handled)
	if handled != 1 {
		t.Fatal("the category is theirs")
	}
	if code, answer := w.call("POST", people+teammate+"/role", `{"role":"owner"}`, screensSecret, w.cookie); code != 200 {
		t.Fatalf("made an owner: %d %v", code, answer)
	}
	if code, answer := w.call("POST", people+teammate+"/remove", "", screensSecret, w.cookie); code != 200 {
		t.Fatalf("removed: %d %v", code, answer)
	}
	var removed bool
	w.pool.QueryRow(ctx, `SELECT deactivated_at IS NOT NULL FROM users WHERE company_id = $1 AND id = $2`, w.company.String(), teammate).Scan(&removed)
	if !removed {
		t.Fatal("they are removed")
	}
	// Anything but letters, digits, "_" and "-" is no person's id.
	if code, _ := w.call("POST", people+"not.an.id/role", `{"role":"owner"}`, screensSecret, w.cookie); code != 400 {
		t.Fatalf("a made-up id's role: %d", code)
	}
	if code, _ := w.call("POST", people+"not%20an%20id/remove", "", screensSecret, w.cookie); code != 404 {
		t.Fatalf("a made-up id's removal: %d", code)
	}
}
