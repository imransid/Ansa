package main

import (
	"context"
	"fmt"
	"io"
	"strconv"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/commands"
	"ansa/core/internal/drafts"
	"ansa/core/internal/logging"
	"ansa/core/internal/profile"
	"ansa/core/internal/publishing"
	"ansa/core/internal/socialconnect"
	"ansa/core/internal/strategy"
	"ansa/core/internal/studio"
)

// The restaurant's marketing (the Marketing planner and Social media
// posts): its key facts confirmed, a marketing plan made by core's planner
// (a scripted brain writing it), stand-in LinkedIn and X accounts, and posts
// at every step: an idea, a draft, an approved one, one scheduled, and five
// published on the stand-in Facebook Page with their numbers (enough for
// "Review performance", which the presenter asks for live).
func setUpMarketing(ctx context.Context, w *world, a demoAccount) error {
	for _, fact := range demoFacts {
		outcome, err := profile.SaveValue(ctx, w.pool, a.company, a.userID, fact[0], "", fact[1])
		if err != nil || (outcome != profile.Saved && outcome != studio.Changed) {
			return refusedStep(err, "the fact "+fact[0]+" confirmed", outcome)
		}
	}
	accounts := &socialconnect.Connector{Pool: w.pool, Box: w.box, Log: logging.New(io.Discard), AppURL: w.cfg.AppURL, Development: true}
	for _, platform := range []string{"linkedin", "x"} {
		if _, err := accounts.ConnectStandIn(ctx, a.company, a.userID, platform); err != nil {
			return err
		}
	}
	if err := makeDemoPlan(ctx, w, a); err != nil {
		return err
	}
	if err := writeDemoPosts(ctx, w, a); err != nil {
		return err
	}
	return runSteps([]demoStep{
		{"interview", func() (string, error) { return "saved", addDemoInterview(ctx, w, a) }},
		{"AI-written draft", func() (string, error) { return "saved", addWrittenDraft(ctx, w, a) }},
		{"rejected and archived drafts", func() (string, error) { return "saved", addDecidedDrafts(ctx, w, a) }},
	})
}

// makeDemoPlan makes version 1 of the plan through core's planner.
func makeDemoPlan(ctx context.Context, w *world, a demoAccount) error {
	brain := newScriptedBrain()
	defer brain.server.Close()
	brain.next(marshal(map[string]any{"kind": "ok", "plan": demoPlan}))
	planner := &strategy.Planner{Pool: w.pool, Brain: brainclient.New(brain.server.URL, w.cfg.BrainSharedSecret, 30*time.Second), Log: logging.New(io.Discard)}
	result, err := planner.Make(ctx, a.company, a.userID, "More weekday lunch orders from offices nearby, and catering bookings for the wedding season.")
	if err != nil {
		return err
	}
	if result.Version != 1 {
		return commands.Refusal(fmt.Sprintf("The demo's marketing plan wasn't made (%+v).", result))
	}
	return nil
}

// writeDemoPosts writes each post as a person does in Social media posts,
// takes it as far as its step, and publishes the published ones.
func writeDemoPosts(ctx context.Context, w *world, a demoAccount) error {
	connections := map[string]string{}
	rows, err := w.pool.Query(ctx, `SELECT platform, id::text FROM social_connections WHERE company_id = $1 AND status = 'connected'`, a.company.String())
	if err != nil {
		return err
	}
	for rows.Next() {
		var platform, id string
		if err := rows.Scan(&platform, &id); err != nil {
			rows.Close()
			return err
		}
		connections[platform] = id
	}
	rows.Close()
	tomorrow := time.Now().Add(24 * time.Hour).Truncate(time.Hour)
	var published []string
	for _, post := range demoPosts {
		jobIDs, err := writeDemoPost(ctx, w, a, post, connections[post.platform], tomorrow)
		if err != nil {
			return err
		}
		if post.step == "published" {
			published = append(published, jobIDs...)
		}
	}
	imageJob, err := addImagePost(ctx, w, a, connections["facebook"])
	if err != nil {
		return err
	}
	published = append(published, imageJob)
	if err := publishNow(ctx, w, a, published); err != nil {
		return err
	}
	if err := simulateNumbers(ctx, w, published); err != nil {
		return err
	}
	if err := spreadPublishedPosts(ctx, w, a, published); err != nil {
		return err
	}
	fmt.Fprintf(w.out, "Added a marketing plan and %d posts (%d published, with numbers).\n", len(demoPosts)+1, len(published))
	return nil
}

// When each published post went out, in the restaurant's time: over the
// last three weeks, on different days and hours (the Analytics page and a
// performance review read them), oldest first.
var publishedAgo = []struct{ days, hour int }{{19, 11}, {15, 13}, {11, 12}, {8, 19}, {5, 16}, {2, 12}}

// spreadPublishedPosts moves the published posts and their numbers back to
// those times (development only).
func spreadPublishedPosts(ctx context.Context, w *world, a demoAccount, jobIDs []string) error {
	dhaka, err := time.LoadLocation("Asia/Dhaka")
	if err != nil {
		return err
	}
	today := time.Now().In(dhaka)
	for i, jobID := range jobIDs {
		when := publishedAgo[i%len(publishedAgo)]
		at := time.Date(today.Year(), today.Month(), today.Day()-when.days, when.hour, 0, 0, 0, dhaka)
		for _, statement := range []string{
			`UPDATE publish_jobs SET scheduled_for = $3, published_at = $3, updated_at = $3 WHERE company_id = $1 AND id = $2`,
			`UPDATE post_metrics SET collected_at = $3::timestamptz + interval '1 day' WHERE company_id = $1 AND publish_job_id = $2`,
		} {
			if _, err := w.pool.Exec(ctx, statement, a.company.String(), jobID, at); err != nil {
				return err
			}
		}
	}
	return nil
}

// waitUntilPublished waits (up to 20 seconds) until every one of the jobs
// went out, whoever sent it.
func waitUntilPublished(ctx context.Context, w *world, a demoAccount, jobIDs []string) error {
	for try := 0; try < 200; try++ {
		var waiting int
		err := w.pool.QueryRow(ctx, `SELECT count(*) FROM publish_jobs WHERE company_id = $1 AND id::text = ANY($2) AND status <> 'published'`,
			a.company.String(), jobIDs).Scan(&waiting)
		if err != nil || waiting == 0 {
			return err
		}
		time.Sleep(100 * time.Millisecond)
	}
	return commands.Refusal("The demo's posts didn't go out in time.")
}

// writeDemoPost writes one post and takes it to its step; the posting jobs
// it scheduled, if any.
func writeDemoPost(ctx context.Context, w *world, a demoAccount, post demoPost, connection string, later time.Time) ([]string, error) {
	draftID, outcome, err := studio.Create(ctx, w.pool, a.company, a.userID, studio.NewDraft{Platform: post.platform, Format: "post", Placement: studio.Placement{Topic: post.topic, Pillar: post.pillar}}, nil)
	if err != nil || draftID == "" {
		return nil, refusedStep(err, "created", outcome)
	}
	if post.step == "idea" {
		return nil, nil
	}
	fields := drafts.Fields{Body: post.body, Hashtags: post.hashtags, CallToAction: post.callToAction}
	if outcome, err := studio.Edit(ctx, w.pool, a.company, a.userID, draftID, 1, studio.Placement{Topic: post.topic, Pillar: post.pillar}, fields); err != nil || outcome != studio.Changed {
		return nil, refusedStep(err, "written", outcome)
	}
	if post.step == "draft" {
		return nil, nil
	}
	if approved, err := studio.Approve(ctx, w.pool, a.company, a.userID, draftID, 2, true); err != nil || approved.Outcome != "approved" {
		return nil, refusedStep(err, "approved", approved.Outcome)
	}
	if post.step == "approved" {
		return nil, nil
	}
	request := publishing.ScheduleRequest{DraftID: draftID, ShownVersion: 2, ConnectionIDs: []string{connection}}
	if post.step == "scheduled" {
		request.At = &later
	}
	scheduled, err := publishing.Schedule(ctx, w.pool, a.company, a.userID, request)
	if err != nil || scheduled.Outcome != "scheduled" {
		return nil, refusedStep(err, "scheduled", scheduled.Outcome)
	}
	return scheduled.JobIDs, nil
}

func refusedStep(err error, step, outcome string) error {
	if err != nil {
		return err
	}
	return commands.Refusal("A step of the demo wasn't " + step + " (" + strconv.Quote(outcome) + ").")
}
