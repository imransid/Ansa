package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/comments"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
)

// The restaurant's comments on Facebook (Social media posts → Comments):
// answering switched on, and three comments on its newest published
// kacchi post, each saved as the Page webhook saves one and answered by
// core's own answerer with the scripted brain (the same every time, no AI
// at reset): a question answered in public, a price question in Bangla
// answered with a public note and a private message (its Messenger
// conversation made), and praise left alone.

// demoComment is one comment, how long ago it came, and the brain's proposal.
type demoComment struct {
	name, text, brain string
	ago               time.Duration
}

var demoComments = []demoComment{
	{"Tahmina", "Do you deliver to Gulshan?",
		commentProposal("question", "public_reply", "Sorry, Gulshan is a bit far for us: we deliver within 5 km of Dhanmondi. You're very welcome to pick up!"), 50 * time.Minute},
	{"Sabbir", "দাম কত?",
		commentProposal("order", "private_message", "কাচ্চি বিরিয়ানি ৳450, আর চারজনের ফ্যামিলি কাচ্চি ৳1,650। অর্ডার করতে এখানেই লিখুন: কী নেবেন, আর ডেলিভারি না পিকআপ।"), 40 * time.Minute},
	{"Nabila", "Looks delicious 😍", commentProposal("thanks", "", ""), 35 * time.Minute},
}

// commentProposal is the brain's proposal for a comment, as it sends it to core.
func commentProposal(kind, field, text string) string {
	proposal := map[string]string{"kind": kind, "public_reply": "", "private_message": "", "subject": "", "summary": "", "category": ""}
	if field != "" {
		proposal[field] = text
	}
	return marshal(proposal)
}

// addDemoComments switches answering comments on and plays the comments.
func addDemoComments(ctx context.Context, w *world, a demoAccount) error {
	outcome, err := comments.SaveOn(ctx, w.pool, a.company, a.userID, true)
	if err := saved("comments switch", outcome, err); err != nil {
		return err
	}
	posts, err := comments.PracticePosts(ctx, w.pool, a.company)
	if err != nil {
		return err
	}
	post := posts[0]
	for _, candidate := range posts {
		if strings.Contains(strings.ToLower(candidate.Text), "kacchi") {
			post = candidate
			break
		}
	}
	brain := newScriptedBrain()
	defer brain.server.Close()
	answerer := &comments.Answerer{Pool: w.pool, Box: w.box, Limiter: ratelimit.New(w.pool, w.cfg.AuthSecret), Log: logging.New(io.Discard),
		Brain: brainclient.New(brain.server.URL, w.cfg.BrainSharedSecret, 30*time.Second), StandInsAllowed: true, StandInDir: filepath.Join(w.cfg.DevFolder, ".dev-messages")}
	for _, c := range demoComments {
		id, err := comments.SavePractice(ctx, w.pool, w.box, a.company, post.ID, c.name, c.text)
		if errors.Is(err, comments.ErrNoStandInPage) {
			fmt.Fprintln(w.out, "No comments on Facebook: there is no stand-in Facebook Page (ansa's Meta app is set up here).")
			return nil
		}
		if err != nil {
			return err
		}
		// The running core would answer it with the real AI: this one is scripted.
		if err := dropQueuedJobs(ctx, w, a, comments.AnswerJobKind); err != nil {
			return err
		}
		brain.next(c.brain)
		if _, err := answerer.Answer(ctx, a.company, id); err != nil {
			return err
		}
		if err := moveCommentBack(ctx, w, a, id, c.ago); err != nil {
			return err
		}
	}
	fmt.Fprintf(w.out, "Added %d comments on a Facebook post.\n", len(demoComments))
	return nil
}

// moveCommentBack moves a comment, and the Messenger conversation its
// private message opened, back to when it came (development only).
func moveCommentBack(ctx context.Context, w *world, a demoAccount, commentID string, ago time.Duration) error {
	shift := fmt.Sprintf("%d seconds", int(ago.Seconds()))
	const statement = `
		UPDATE page_comments SET received_at = received_at - $3::interval, commented_at = commented_at - $3::interval,
			decided_at = decided_at - $3::interval, delivery_started_at = delivery_started_at - $3::interval
		WHERE company_id = $1 AND id = $2
		RETURNING COALESCE(conversation_id::text, '')`
	var conversationID string
	if err := w.pool.QueryRow(ctx, statement, a.company.String(), commentID, shift).Scan(&conversationID); err != nil || conversationID == "" {
		return err
	}
	return moveBack(ctx, w, a, conversationID, ago)
}
