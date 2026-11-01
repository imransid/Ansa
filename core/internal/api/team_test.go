package api

import (
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
