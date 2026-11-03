package main

import (
	"context"
	"io"
	"path/filepath"
	"time"

	"ansa/core/internal/analytics"
	"ansa/core/internal/brainclient"
	"ansa/core/internal/commands"
	"ansa/core/internal/drafts"
	"ansa/core/internal/files"
	"ansa/core/internal/logging"
	"ansa/core/internal/mediagen"
	"ansa/core/internal/profile"
	"ansa/core/internal/publishing"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/studio"
)

// More of the restaurant's marketing (setUpMarketing adds it): the interview
// answered twice (its proposals wait for the owner: the website, the look of
// the business and words to avoid), a draft the AI wrote with its claims (one
// backed by a confirmed fact, one not), a rejected and an archived draft, and
// an image post whose image the development stand-in made. A scripted brain
// answers, as for the plan.

func addDemoInterview(ctx context.Context, w *world, a demoAccount) error {
	brain := newScriptedBrain()
	defer brain.server.Close()
	interview := &profile.Service{Pool: w.pool, Box: w.box, Brain: brainclient.New(brain.server.URL, w.cfg.BrainSharedSecret, 30*time.Second), Log: logging.New(io.Discard)}
	turns := []demoTurn{
		{"We post on Facebook three times a week, and our website is shaplakitchen.example. Our colours are green and gold, like the shapla flower.",
			marshal(map[string]any{"kind": "ok", "interview_complete": false, "next_question": "Are there words or claims the business should never use?",
				"proposed_facts": []map[string]string{{"topic": "website", "value": "shaplakitchen.example"}, {"topic": "visual_identity", "value": "Green and gold, like the shapla flower."}}})},
		{"Never call our food cheap, and don't say we're the best in Dhaka.",
			marshal(map[string]any{"kind": "ok", "interview_complete": true, "next_question": "Thank you! That's what I needed for now.",
				"proposed_facts": []map[string]string{{"topic": "words_to_avoid", "value": "cheap, best in Dhaka"}}})},
	}
	none := ""
	for i, turn := range turns {
		brain.next(turn.brain)
		var openingTopic *string
		if i == 0 {
			openingTopic = &none
		}
		result, err := interview.Answer(ctx, a.company, a.userID, turn.customer, openingTopic)
		if err != nil || result.Outcome != profile.Saved {
			return refusedStep(err, "answered in the interview", result.Outcome)
		}
	}
	return nil
}

// addWrittenDraft has the AI write a LinkedIn post for the wedding season.
func addWrittenDraft(ctx context.Context, w *world, a demoAccount) error {
	brain := newScriptedBrain()
	defer brain.server.Close()
	brain.next(marshal(map[string]any{"kind": "ok", "draft": map[string]any{"title": "", "image_prompt": "", "video_script": "",
		"body": "Planning a wedding this winter? Our kitchen cooks kacchi the old Dhaka way for 20 to 300 guests, and our manager " +
			"helps you plan the menu. Guests always come back for seconds.",
		"hashtags": []string{"weddingcatering", "dhaka"}, "call_to_action": "Message us for a catering menu",
		"claims": []map[string]any{{"text": "We cater for 20 to 300 guests", "fact_topics": []string{"services"}},
			{"text": "Guests always come back for seconds", "fact_topics": []string{}}}}}))
	writer := &studio.Writer{Pool: w.pool, Brain: brainclient.New(brain.server.URL, w.cfg.BrainSharedSecret, 30*time.Second),
		Limiter: ratelimit.New(w.pool, w.cfg.AuthSecret), Log: logging.New(io.Discard)}
	result, err := writer.Generate(ctx, a.company, a.userID, studio.NewDraft{Platform: "linkedin", Format: "post",
		Placement: studio.Placement{Topic: "Wedding season catering", Pillar: "Family and events", Campaign: "Wedding season catering"}})
	if err != nil || result.DraftID == "" {
		return refusedStep(err, "written by the AI", result.Outcome+result.Refusal)
	}
	return nil
}

// addDecidedDrafts adds a draft the owner rejected, with a note, and one archived.
func addDecidedDrafts(ctx context.Context, w *world, a demoAccount) error {
	rejected, err := writeDemoText(ctx, w, a, demoPost{platform: "facebook", topic: "Biryani deal", pillar: "Dish of the day",
		body: "Biryani at the lowest price in town! Hurry, order now!", callToAction: "Order now"})
	if err != nil {
		return err
	}
	note := "Too pushy: say what's in the dish, not the price."
	if outcome, err := studio.Reject(ctx, w.pool, a.company, a.userID, rejected, 2, &note); err != nil || outcome != studio.Changed {
		return refusedStep(err, "rejected", outcome)
	}
	archived, err := writeDemoText(ctx, w, a, demoPost{platform: "facebook", topic: "Eid holiday hours", pillar: "Family and events",
		body: "We're open on both days of Eid, from 12:00. Eid Mubarak from all of us!"})
	if err != nil {
		return err
	}
	if outcome, err := studio.Archive(ctx, w.pool, a.company, a.userID, archived); err != nil || outcome != studio.Changed {
		return refusedStep(err, "archived", outcome)
	}
	return nil
}

// writeDemoText writes a text post as a person does (version 2); its id.
func writeDemoText(ctx context.Context, w *world, a demoAccount, post demoPost) (string, error) {
	place := studio.Placement{Topic: post.topic, Pillar: post.pillar}
	draftID, outcome, err := studio.Create(ctx, w.pool, a.company, a.userID, studio.NewDraft{Platform: post.platform, Format: "post", Placement: place}, nil)
	if err != nil || draftID == "" {
		return "", refusedStep(err, "created", outcome)
	}
	fields := drafts.Fields{Body: post.body, Hashtags: post.hashtags, CallToAction: post.callToAction}
	if outcome, err := studio.Edit(ctx, w.pool, a.company, a.userID, draftID, 1, place, fields); err != nil || outcome != studio.Changed {
		return "", refusedStep(err, "written", outcome)
	}
	return draftID, nil
}

// addImagePost writes a Facebook post with an image the development
// stand-in makes from its description, approves it and schedules it now;
// the posting job.
func addImagePost(ctx context.Context, w *world, a demoAccount, page string) (string, error) {
	place := studio.Placement{Topic: "Kacchi day", Pillar: "From our kitchen"}
	draftID, outcome, err := studio.Create(ctx, w.pool, a.company, a.userID, studio.NewDraft{Platform: "facebook", Format: "image_post", Placement: place}, nil)
	if err != nil || draftID == "" {
		return "", refusedStep(err, "created", outcome)
	}
	fields := drafts.Fields{Body: "Kacchi day: mutton, rice and potatoes, slow-cooked since the morning.", Hashtags: []string{"kacchi", "kacchiday"},
		CallToAction: "Order on WhatsApp", ImagePrompt: "Kacchi biryani on a brass platter, seen from above"}
	if outcome, err := studio.Edit(ctx, w.pool, a.company, a.userID, draftID, 1, place, fields); err != nil || outcome != studio.Changed {
		return "", refusedStep(err, "written", outcome)
	}
	images := &mediagen.Service{Pool: w.pool, Files: &files.Store{DevFolder: w.cfg.DevFolder}, Limiter: ratelimit.New(w.pool, w.cfg.AuthSecret),
		Log: logging.New(io.Discard), Mode: mediagen.ModeFor("", false)}
	jobID, refusal, err := images.RequestForDraft(ctx, a.company, a.userID, draftID, 2)
	if err != nil || jobID == "" {
		return "", refusedStep(err, "given an image", refusal)
	}
	if made := images.Run(ctx, a.company, jobID); made != mediagen.Succeeded {
		return "", commands.Refusal("The demo's image wasn't made (" + made + ").")
	}
	// The image is attached as the draft's next version.
	if approved, err := studio.Approve(ctx, w.pool, a.company, a.userID, draftID, 3, true); err != nil || approved.Outcome != "approved" {
		return "", refusedStep(err, "approved", approved.Outcome)
	}
	scheduled, err := publishing.Schedule(ctx, w.pool, a.company, a.userID, publishing.ScheduleRequest{DraftID: draftID, ShownVersion: 3, ConnectionIDs: []string{page}})
	if err != nil || scheduled.Outcome != "scheduled" {
		return "", refusedStep(err, "scheduled", scheduled.Outcome)
	}
	return scheduled.JobIDs[0], nil
}

// publishNow sends the company's due posts here and waits until the jobs
// went out (the running core's own round may send some of them).
func publishNow(ctx context.Context, w *world, a demoAccount, jobIDs []string) error {
	publisher := &publishing.Runner{Pool: w.pool, Box: w.box, Limiter: ratelimit.New(w.pool, w.cfg.AuthSecret), Log: logging.New(io.Discard),
		Files: &files.Store{DevFolder: w.cfg.DevFolder}, StandInsAllowed: true, StandInDir: filepath.Join(w.cfg.DevFolder, ".dev-social"),
		PublishFacebook: publishing.PublishToFacebook}
	if _, err := publisher.RunDue(ctx, a.company.String()); err != nil {
		return err
	}
	return waitUntilPublished(ctx, w, a, jobIDs)
}

// simulateNumbers saves made-up numbers for each published job, marked
// simulated wherever they show.
func simulateNumbers(ctx context.Context, w *world, jobIDs []string) error {
	for i, jobID := range jobIDs {
		if _, refusal, err := analytics.SimulatePostMetrics(ctx, w.pool, jobID, demoNumbers[i%len(demoNumbers)], true); err != nil || refusal != "" {
			return refusedStep(err, "given numbers", refusal)
		}
	}
	return nil
}
