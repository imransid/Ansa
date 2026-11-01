package mediagen

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func done(prompt string) (Started, error) {
	data, err := FlatColorPNG(ColorOfPrompt(prompt))
	return Started{Status: "done", Output: Output{Bytes: data}}, err
}

func TestFiveRunsOfOneRequestAtTheSameMomentMakeOneAsset(t *testing.T) {
	fake := &fakeService{start: func(r Request) (Started, error) { time.Sleep(20 * time.Millisecond); return done(r.Prompt) }}
	w := newGenWorld(t, Mode{Provider: fake})
	id := w.request("image", "A loaf")
	var group sync.WaitGroup
	for range 5 {
		group.Add(1)
		go func() {
			defer group.Done()
			w.service.Run(context.Background(), w.company, id)
		}()
	}
	group.Wait()
	if fake.starts != 1 || w.count(`SELECT count(*) FROM media_assets WHERE company_id = $1`) != 1 {
		t.Fatalf("one request to the service, one asset: %d starts", fake.starts)
	}
}

func TestAServiceWorkingInTheBackgroundIsPolledNeverAskedAgain(t *testing.T) {
	ready := false
	fake := &fakeService{
		start: func(Request) (Started, error) { return Started{Status: "started", ProviderJobID: "svc-1"}, nil },
		poll: func(id string) (Polled, error) {
			if !ready || id != "svc-1" {
				return Polled{Status: "running"}, nil
			}
			data, _ := FlatColorPNG(ColorOfPrompt("x"))
			return Polled{Status: "done", Output: Output{Bytes: data}}, nil
		},
	}
	w := newGenWorld(t, Mode{Provider: fake})
	// Room for polls: each may take the fake's 2 seconds.
	w.service.Budget = 2*time.Second + 50*time.Millisecond
	ctx := context.Background()
	id := w.request("image", "A loaf")
	if outcome := w.service.Run(ctx, w.company, id); outcome != Unfinished {
		t.Fatalf("still working when the budget ends: %s", outcome)
	}
	var kept *string
	w.pool.QueryRow(ctx, `SELECT provider_job_id FROM media_generation_jobs WHERE company_id = $1 AND id = $2`, w.company.String(), id).Scan(&kept)
	if kept == nil || *kept != "svc-1" {
		t.Fatal("the service's id is kept before the first poll")
	}
	// A later run (the first was cut off 15+ minutes ago) polls it.
	ready = true
	w.exec(`UPDATE media_generation_jobs SET started_at = now() - interval '16 minutes' WHERE company_id = $1 AND id = $2`, w.company.String(), id)
	if outcome := w.service.Run(ctx, w.company, id); outcome != Succeeded || fake.starts != 1 {
		t.Fatalf("polled, never asked again: %s, %d starts", outcome, fake.starts)
	}
}

func TestAResultIsKeptOnlyWhenItsBytesAreOfTheKindAsked(t *testing.T) {
	cases := map[string]func(Request) (Started, error){
		"unexpected_output": func(Request) (Started, error) {
			return Started{Status: "done", Output: Output{Bytes: []byte("<svg/>")}}, nil
		},
		"download_failed": func(Request) (Started, error) {
			return Started{Status: "done", Output: Output{URL: "https://elsewhere.test/a.png"}}, nil
		},
		"provider_refused": func(Request) (Started, error) { return Started{Status: "failed", Code: "provider_refused"}, nil },
		"provider_failed":  func(Request) (Started, error) { return Started{}, errors.New("broken") },
	}
	for code, start := range cases {
		w := newGenWorld(t, Mode{Provider: &fakeService{start: start}})
		id := w.request("image", "A loaf")
		w.service.Run(context.Background(), w.company, id)
		if status, got, asset := w.job(id); status != "failed" || *got != code || asset != nil {
			t.Fatalf("%s: %s %v", code, status, *got)
		}
	}
	// An image asked as a video is unexpected too.
	w := newGenWorld(t, Mode{Provider: &fakeService{start: func(r Request) (Started, error) { return done(r.Prompt) }}})
	id := w.request("video", "A clip")
	w.service.Run(context.Background(), w.company, id)
	if _, code, _ := w.job(id); *code != "unexpected_output" {
		t.Fatalf("the kind asked: %s", *code)
	}
}

func TestARunCutOffThreeTimesIsEndedAsInterrupted(t *testing.T) {
	w := newGenWorld(t, Mode{Provider: &fakeService{start: func(r Request) (Started, error) { return done(r.Prompt) }}})
	id := w.request("image", "A loaf")
	w.exec(`UPDATE media_generation_jobs SET status = 'running', attempts = 3, started_at = now() - interval '16 minutes' WHERE company_id = $1 AND id = $2`, w.company.String(), id)
	if _, outcome := w.service.Claim(context.Background(), w.company, id); outcome != GivenUp {
		t.Fatalf("given up: %s", outcome)
	}
	if status, code, asset := w.job(id); status != "failed" || *code != "interrupted" || asset != nil {
		t.Fatalf("interrupted, no asset: %s", status)
	}
}

func TestCancelWorksOnlyWhileItWaitsAndStuckOnesAreTakenUp(t *testing.T) {
	w := newGenWorld(t, ModeFor("", false))
	ctx := context.Background()
	waiting := w.request("image", "A loaf")
	if outcome, _ := Cancel(ctx, w.pool, w.company, w.owner, waiting); outcome != "canceled" {
		t.Fatalf("canceled: %s", outcome)
	}
	if outcome := w.service.Run(ctx, w.company, waiting); outcome != NotClaimed {
		t.Fatalf("a canceled one never runs: %s", outcome)
	}
	if outcome, _ := Cancel(ctx, w.pool, w.company, w.owner, waiting); outcome != "wrong-status" {
		t.Fatalf("only while it waits: %s", outcome)
	}
	stuck := w.request("image", "Another loaf")
	if isStuck, _ := IsStuck(ctx, w.pool, w.company, stuck); isStuck == nil || *isStuck {
		t.Fatal("a fresh request isn't stuck")
	}
	w.exec(`UPDATE media_generation_jobs SET created_at = now() - interval '3 minutes' WHERE company_id = $1 AND id = $2`, w.company.String(), stuck)
	// The finder reads every company (ids only); the test runs only its own
	// company's request, never another's (the database may hold real ones).
	found, err := w.service.findStuck(ctx, 1_000)
	var mine *stuckJob
	for i := range found {
		if found[i].jobID == stuck && found[i].company == w.company {
			mine = &found[i]
		}
	}
	if err != nil || mine == nil {
		t.Fatalf("the periodic task finds it: %v", err)
	}
	w.service.Run(ctx, mine.company, mine.jobID)
	if status, _, _ := w.job(stuck); status != "succeeded" {
		t.Fatalf("made: %s", status)
	}
}
