package api

import (
	"context"
	"testing"
)

// The comments switch: everyone reads it with the Pages (allowed = both
// comment permissions, or a stand-in); only an owner of a business changes it.
func TestTheCommentsSwitchIsTheOwners(t *testing.T) {
	w := newAPIWorld(t)
	t.Cleanup(func() {
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, w.api.Limiter.Key("settings-changes", w.ownerID()))
	})
	if code, _ := w.call("POST", "/api/v1/social/facebook/stand-in", "", screensSecret, w.cookie); code != 200 {
		t.Fatalf("stand-in Page: %d", code)
	}
	code, answer := w.call("GET", "/api/v1/comments/settings", "", screensSecret, w.cookie)
	pages, _ := answer["pages"].([]any)
	if code != 200 || answer["on"] != false || answer["canChange"] != true || len(pages) != 1 || pages[0].(map[string]any)["allowed"] != true {
		t.Fatalf("the switch and the Pages: %d %v", code, answer)
	}
	if code, answer := w.call("POST", "/api/v1/comments/settings", `{"on":true}`, screensSecret, w.cookie); code != 200 || answer["outcome"] != "saved" {
		t.Fatalf("switched on: %d %v", code, answer)
	}
	if _, answer := w.call("GET", "/api/v1/comments/settings", "", screensSecret, w.cookie); answer["on"] != true {
		t.Fatal("on")
	}
	if code, _ := w.call("POST", "/api/v1/comments/settings", `{"on":true,"companyId":"x"}`, screensSecret, w.cookie); code != 400 {
		t.Fatal("an unknown field is refused")
	}
	w.must(`UPDATE companies SET kind = 'personal' WHERE id = $1`, w.company.String())
	if code, _ := w.call("POST", "/api/v1/comments/settings", `{"on":true}`, screensSecret, w.cookie); code != 409 {
		t.Fatal("businesses only")
	}
	w.must(`UPDATE companies SET kind = 'business' WHERE id = $1`, w.company.String())
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1`, w.company.String())
	if code, _ := w.call("POST", "/api/v1/comments/settings", `{"on":false}`, screensSecret, w.cookie); code != 403 {
		t.Fatal("members read only")
	}
	if _, answer := w.call("GET", "/api/v1/comments/settings", "", screensSecret, w.cookie); answer["canChange"] != false {
		t.Fatal("a member can't change it")
	}
}

// The practice comment box (development, owners): the stand-in Page's
// posts (ansa's fixed one when it has none), a comment saved as Meta's
// webhook saves one, its answer queued, read back with what ansa is doing;
// the list shows it; Send and Discard answer as the contract says.
func TestThePracticeCommentAndTheList(t *testing.T) {
	w := newAPIWorld(t)
	t.Cleanup(func() {
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, w.api.Limiter.Key("practice-comments", w.company.String()))
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, w.api.Limiter.Key("settings-changes", w.ownerID()))
	})
	code, answer := w.call("GET", "/api/v1/practice/comment/posts", "", screensSecret, w.cookie)
	posts, _ := answer["posts"].([]any)
	if code != 200 || len(posts) != 1 || posts[0].(map[string]any)["id"] != "dev-post-todays-special" {
		t.Fatalf("the fixed stand-in post: %d %v", code, answer)
	}
	comment := `{"postId":"dev-post-todays-special","name":"Lena","text":"Do you deliver to Gulshan?"}`
	if code, _ := w.call("POST", "/api/v1/practice/comment", comment, screensSecret, w.cookie); code != 409 {
		t.Fatal("a stand-in Page first")
	}
	w.call("POST", "/api/v1/social/facebook/stand-in", "", screensSecret, w.cookie)
	w.call("POST", "/api/v1/comments/settings", `{"on":true}`, screensSecret, w.cookie)
	code, answer = w.call("POST", "/api/v1/practice/comment", comment, screensSecret, w.cookie)
	id, _ := answer["commentId"].(string)
	if code != 200 || id == "" || w.count(`SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'comment.answer'`) != 1 {
		t.Fatalf("saved and its answer queued: %d %v", code, answer)
	}
	code, one := w.call("GET", "/api/v1/practice/comment/"+id, "", screensSecret, w.cookie)
	if code != 200 || one["next"] != "answering" || one["text"] != "Do you deliver to Gulshan?" || one["readable"] != true || one["commenterName"] != "Lena" ||
		one["postText"] != "Today's special: Kacchi Biryani, cooked fresh this morning." || one["status"] != "new" || one["publicReply"] != nil || one["requestNumber"] != 0.0 {
		t.Fatalf("one comment: %d %v", code, one)
	}
	if code, _ := w.call("POST", "/api/v1/practice/comment", `{"postId":"made-up","name":"Lena","text":"Hi"}`, screensSecret, w.cookie); code != 400 {
		t.Fatal("only one of the offered posts")
	}
	if code, _ := w.call("POST", "/api/v1/practice/comment", `{"postId":"dev-post-todays-special","name":"","text":""}`, screensSecret, w.cookie); code != 400 {
		t.Fatal("fields checked")
	}
	code, list := w.call("GET", "/api/v1/comments?page=1", "", screensSecret, w.cookie)
	rows, _ := list["comments"].([]any)
	if code != 200 || len(rows) != 1 || list["total"] != 1.0 || list["page"] != 1.0 || list["pageSize"] != 50.0 || list["commentsOn"] != true {
		t.Fatalf("the list: %d %v", code, list)
	}
	if code, answer := w.call("POST", "/api/v1/comments/"+id+"/send", "{}", screensSecret, w.cookie); code != 200 || answer["outcome"] != "changed" {
		t.Fatalf("not waiting: %d %v", code, answer)
	}
	w.must(`UPDATE page_comments SET status = 'waiting', decided_at = now(), kind = 'question', public_reply_encrypted = 'v1:x:y:z', public_reply_status = 'waiting'
		WHERE company_id = $1`, w.company.String())
	if code, answer := w.call("POST", "/api/v1/comments/"+id+"/discard", "{}", screensSecret, w.cookie); code != 200 || answer["outcome"] != "discarded" {
		t.Fatalf("discarded: %d %v", code, answer)
	}
	if _, one := w.call("GET", "/api/v1/practice/comment/"+id, "", screensSecret, w.cookie); one["status"] != "skipped" || one["skipReason"] != "" || one["next"] != "done" {
		t.Fatalf("discarded shows as skipped: %v", one)
	}
	if code, _ := w.call("GET", "/api/v1/practice/comment/"+anotherCompanysConversation(t, w), "", screensSecret, w.cookie); code != 404 {
		t.Fatal("not this company's comment")
	}
	w.api.Development = false
	if code, _ := w.call("POST", "/api/v1/practice/comment", comment, screensSecret, w.cookie); code != 403 {
		t.Fatal("development only")
	}
}
