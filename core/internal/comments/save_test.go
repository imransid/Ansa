package comments

import (
	"context"
	"testing"
	"time"

	"ansa/core/internal/messenger"
	"ansa/core/internal/tenant"
)

// A comment is saved once, encrypted for its company and row, with its
// answer queued; what ansa never answers is saved skipped (or, for the
// Page's own replies in a thread, not at all).
func TestSavingKeepsEachCommentOnceAndSaysWhatIsNeverAnswered(t *testing.T) {
	w := newCommentWorld(t)
	id := w.comment("c-1", "lena", "Do you deliver to Gulshan?")
	if id == "" || w.comment("c-1", "lena", "Do you deliver to Gulshan?") != "" {
		t.Fatal("saved once per Meta comment id (an ad can send it twice)")
	}
	if w.count(`SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'comment.answer'`) != 1 {
		t.Fatal("its answer is queued")
	}
	var stored string
	w.pool.QueryRow(context.Background(), `SELECT text_encrypted FROM page_comments WHERE company_id = $1 AND id = $2`, w.company.String(), id).Scan(&stored)
	if text, err := w.box.Decrypt(stored, TextContext(w.company, id, "text")); err != nil || text != "Do you deliver to Gulshan?" {
		t.Fatalf("encrypted for its company and comment: %q %v", text, err)
	}
	other, _ := tenant.FromTrustedSource("00000000-0000-4000-8000-000000000000")
	if _, err := w.box.Decrypt(stored, TextContext(other, id, "text")); err == nil {
		t.Fatal("unreadable as another company's")
	}

	thread := func(e *messenger.CommentEvent) { e.ParentID = "c-1" }
	if w.comment("c-2", w.pageID, "Yes we do!", thread) != "" {
		t.Fatal("the Page's own reply in a thread (ansa's own come back so) is never kept")
	}
	cases := map[string]string{
		w.comment("c-3", w.pageID, "New dish today!"): SkipOwnComment,
		w.comment("c-4", "marco", "Me too!", thread):  SkipReplyInThread,
		w.comment("c-5", "rita", "Open?", func(e *messenger.CommentEvent) { e.CreatedAt = time.Now().Add(-8 * 24 * time.Hour) }): SkipTooOld,
	}
	for id, reason := range cases {
		if view := w.view(id); view.Status != StatusSkipped || view.SkipReason != reason {
			t.Errorf("%s: %+v", reason, view)
		}
	}
	if w.count(`SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'comment.answer'`) != 1 {
		t.Fatal("nothing skipped is answered")
	}
}

// Switched off, a person's account, a Page without the two permissions, or
// a package without comments: saved, skipped with why.
func TestTheSwitchThePageAndThePackageDecide(t *testing.T) {
	w := newCommentWorld(t)
	w.must(`UPDATE assistant_settings SET comments_on = false WHERE company_id = $1`, w.company.String())
	if view := w.view(w.comment("o-1", "lena", "Open today?")); view.SkipReason != SkipCommentsOff {
		t.Fatalf("switched off: %+v", view)
	}
	w.must(`UPDATE assistant_settings SET comments_on = true WHERE company_id = $1`, w.company.String())
	w.must(`UPDATE companies SET kind = 'personal' WHERE id = $1`, w.company.String())
	if view := w.view(w.comment("o-2", "lena", "Open today?")); view.SkipReason != SkipCommentsOff {
		t.Fatalf("one person's account: %+v", view)
	}
	w.must(`UPDATE companies SET kind = 'business' WHERE id = $1`, w.company.String())
	w.must(`UPDATE social_connections SET is_stand_in = false, external_account_id = '424242', scopes = ARRAY['pages_read_user_content'] WHERE company_id = $1`, w.company.String())
	w.pageID = "424242"
	if view := w.view(w.comment("o-3", "4242", "Open today?")); view.SkipReason != SkipNotAllowed {
		t.Fatalf("one comment permission only: %+v", view)
	}
	w.must(`UPDATE social_connections SET scopes = ARRAY['pages_read_user_content', 'pages_manage_engagement'] WHERE company_id = $1`, w.company.String())
	if view := w.view(w.comment("o-4", "4242", "Open today?")); view.Status != StatusNew {
		t.Fatalf("both permissions: %+v", view)
	}
	w.must(`UPDATE companies SET trial_ends_at = now() - interval '1 day' WHERE id = $1`, w.company.String())
	if view := w.view(w.comment("o-5", "4242", "Open today?")); view.SkipReason != SkipPackage {
		t.Fatalf("no package: %+v", view)
	}
}
