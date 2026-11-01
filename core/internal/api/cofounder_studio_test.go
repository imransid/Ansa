package api

import (
	"context"
	"testing"
)

func TestTheContentStudioThroughCoresAPI(t *testing.T) {
	w := newAPIWorld(t)
	var owner string
	w.pool.QueryRow(context.Background(), `SELECT id FROM users WHERE company_id = $1`, w.company.String()).Scan(&owner)
	t.Cleanup(func() {
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, w.api.Limiter.Key("content-draft-changes", owner))
	})
	newDraft := `{"platform":"x","format":"post","topic":"Bread","pillar":"","campaign":"","withAi":false}`
	code, answer := w.call("POST", "/api/v1/cofounder/drafts", newDraft, screensSecret, w.cookie)
	id, _ := answer["draftId"].(string)
	if code != 200 || id == "" {
		t.Fatalf("a blank draft: %d %v", code, answer)
	}
	sneaky := `{"platform":"x","format":"post","topic":"Bread","pillar":"","campaign":"","withAi":false,"companyId":"` + w.company.String() + `"}`
	if code, _ := w.call("POST", "/api/v1/cofounder/drafts", sneaky, screensSecret, w.cookie); code != 400 {
		t.Fatalf("a body naming a company is refused: %d", code)
	}
	code, answer = w.call("GET", "/api/v1/cofounder/drafts?status=nonsense&platform=x", "", screensSecret, w.cookie)
	counts, _ := answer["counts"].(map[string]any)
	if code != 200 || answer["status"] != "current" || counts["idea"] != 1.0 || len(answer["drafts"].([]any)) != 1 {
		t.Fatalf("the list falls back to current: %d %v", code, answer)
	}
	code, answer = w.call("GET", "/api/v1/cofounder/drafts/"+id, "", screensSecret, w.cookie)
	draft, _ := answer["draft"].(map[string]any)
	if code != 200 || draft["status"] != "idea" || answer["canReview"] != true {
		t.Fatalf("the draft's page: %d %v", code, answer)
	}
	edit := `{"version":1,"topic":"Bread","pillar":"","campaign":"","title":"","body":"Fresh bread.","hashtags":"#bread","callToAction":"","imagePrompt":"","videoScript":""}`
	if code, answer := w.call("POST", "/api/v1/cofounder/drafts/"+id+"/edit", edit, screensSecret, w.cookie); code != 200 || answer["outcome"] != "changed" {
		t.Fatalf("an edit: %d %v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/cofounder/drafts/"+id+"/edit", edit, screensSecret, w.cookie); code != 409 {
		t.Fatalf("an edit of version 1 again is stale: %d", code)
	}
	if code, answer := w.call("POST", "/api/v1/cofounder/drafts/"+id+"/approve", `{"version":2,"claimsChecked":false}`, screensSecret, w.cookie); code != 422 {
		t.Fatalf("a hand-written text needs the tick: %d %v", code, answer)
	}
	if code, answer := w.call("POST", "/api/v1/cofounder/drafts/"+id+"/approve", `{"version":2,"claimsChecked":true}`, screensSecret, w.cookie); code != 200 || answer["outcome"] != "approved" {
		t.Fatalf("approved: %d %v", code, answer)
	}
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1`, w.company.String())
	if code, answer := w.call("POST", "/api/v1/cofounder/drafts/"+id+"/reject", `{"version":2,"note":""}`, screensSecret, w.cookie); code != 403 || answer["error"] != onlyOwnersDecide {
		t.Fatalf("members can't reject: %d %v", code, answer)
	}
	if code, _ := w.call("GET", "/api/v1/cofounder/drafts/00000000-0000-0000-0000-000000000000", "", screensSecret, w.cookie); code != 404 {
		t.Fatalf("an unknown draft: %d", code)
	}
}
