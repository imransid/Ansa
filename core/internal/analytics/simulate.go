package analytics

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Simulated numbers (the old services/post-metrics-simulation.ts and
// db/post-metrics-simulation.ts), development only: numbers for a
// development stand-in's published post, so the Analytics page and the
// performance review can be tried before any platform gives real ones.
// Never for a real account's post (its numbers come from its platform),
// never in production, and only numbers the post's platform has (X has no
// reach). Labeled "Simulated (development)" wherever they show.

// SimulateUsage says how to run the command.
var SimulateUsage = "usage: go run ./cmd/simulate post-metrics <publish job id> " + everyArgument() + " (one or more)"

func everyArgument() string {
	var arguments []string
	for _, column := range MetricColumns {
		arguments = append(arguments, column+"=<number>")
	}
	return strings.Join(arguments, " ")
}

// MetricValue is one simulated number.
type MetricValue struct {
	Column string
	Value  int64
}

var (
	metricArgument = regexp.MustCompile(`^([a-z_]+)=(.*)$`)
	wholeNumber    = regexp.MustCompile(`^\d{1,10}$`)
	jobIDPattern   = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
)

// ReadMetricArguments reads "views=120 reactions=8": known names, each once,
// whole numbers from 0 to Postgres's integer, in the order given. The
// second value is why not ("" when they read).
func ReadMetricArguments(args []string) ([]MetricValue, string) {
	var values []MetricValue
	seen := map[string]bool{}
	for _, argument := range args {
		match := metricArgument.FindStringSubmatch(argument)
		if match == nil || MetricLabels[match[1]] == "" {
			return nil, `"` + argument + `" isn't a number ansa keeps. ` + SimulateUsage
		}
		column := match[1]
		if seen[column] {
			return nil, column + " is given twice."
		}
		count, err := strconv.ParseInt(match[2], 10, 64)
		if !wholeNumber.MatchString(match[2]) || err != nil || count > MetricValueMax {
			return nil, column + " must be a whole number from 0 to " + strconv.Itoa(MetricValueMax) + "."
		}
		seen[column] = true
		values = append(values, MetricValue{Column: column, Value: count})
	}
	if len(values) == 0 {
		return nil, "Give at least one number. " + SimulateUsage
	}
	return values, ""
}

// Simulated is a saved simulation: the post's company and platform.
type Simulated struct {
	Company  tenant.CompanyID
	Platform string
}

// SimulatePostMetrics saves simulated numbers for one stand-in post, or
// says why not (the second value). development: false refuses everything.
func SimulatePostMetrics(ctx context.Context, pool *database.Pool, jobIDText string, args []string, development bool) (Simulated, string, error) {
	if !development {
		return Simulated{}, "Simulated numbers are for development only: production reads real posts' numbers from their platforms.", nil
	}
	if !jobIDPattern.MatchString(jobIDText) {
		return Simulated{}, `"` + jobIDText + `" isn't a publish job id. ` + SimulateUsage, nil
	}
	jobID := strings.ToLower(jobIDText)
	values, refusal := ReadMetricArguments(args)
	if refusal != "" {
		return Simulated{}, refusal, nil
	}
	post, err := findPostForSimulation(ctx, pool, jobID)
	switch {
	case err != nil:
		return Simulated{}, "", err
	case post == nil:
		return Simulated{}, "No post has that id.", nil
	case !post.isStandIn:
		return Simulated{}, "That post went to a real account: its numbers come from its platform only, never from a simulation.", nil
	case post.status != "published":
		return Simulated{}, "That post hasn't gone out, so it has no numbers yet.", nil
	}
	if refusal := notOfferedRefusal(post.platform, values); refusal != "" {
		return Simulated{}, refusal, nil
	}
	saved, err := saveSimulatedMetrics(ctx, pool, post.company, jobID, values)
	if err != nil || !saved {
		return Simulated{}, "That post changed meanwhile: try again.", err
	}
	return Simulated{Company: post.company, Platform: post.platform}, "", nil
}

// notOfferedRefusal: "X gives no reach: leave it out." ("" when the
// platform has every number given).
func notOfferedRefusal(platform string, values []MetricValue) string {
	given := map[string]bool{}
	for _, value := range values {
		given[value.Column] = true
	}
	var names []string
	for _, column := range MetricColumns {
		if given[column] && !PlatformOffers(platform, column) {
			names = append(names, strings.ToLower(MetricLabels[column]))
		}
	}
	if len(names) == 0 {
		return ""
	}
	pronoun := "them"
	if len(names) == 1 {
		pronoun = "it"
	}
	return PlatformLabels[platform] + " gives no " + strings.Join(names, " or ") + ": leave " + pronoun + " out."
}

type postForSimulation struct {
	company          tenant.CompanyID
	status, platform string
	isStandIn        bool
}

// findPostForSimulation reads the post the command names by its id, with
// its company. Not company-scoped on purpose: a development command run by
// hand has no session; it reads one row by an id nobody can guess, and
// writes only through the company-scoped save below.
func findPostForSimulation(ctx context.Context, pool *database.Pool, jobID string) (*postForSimulation, error) {
	const statement = `
		-- cross-company: a development command finds the post it names by its id (development and a local database only); it then writes through the company-scoped save.
		SELECT jobs.company_id, jobs.status, accounts.platform, accounts.is_stand_in
		FROM publish_jobs AS jobs
		JOIN social_connections AS accounts ON accounts.company_id = jobs.company_id AND accounts.id = jobs.connection_id
		WHERE jobs.id = $1`
	var post postForSimulation
	var companyText string
	err := pool.QueryRow(ctx, statement, jobID).Scan(&companyText, &post.status, &post.platform, &post.isStandIn)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	post.company, err = tenant.FromTrustedSource(companyText)
	return &post, err
}

// saveSimulatedMetrics saves a dev_simulated snapshot of one company's
// published post of a stand-in account, the post locked while it is read.
// False: the company has no such post (not published, or a real account's).
// Every column named; a number not given is NULL.
func saveSimulatedMetrics(ctx context.Context, pool *database.Pool, company tenant.CompanyID, jobID string, values []MetricValue) (bool, error) {
	columns := map[string]*int64{}
	for _, value := range values {
		columns[value.Column] = &value.Value
	}
	saved := false
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		const lock = `
			SELECT jobs.id FROM publish_jobs AS jobs
			JOIN social_connections AS accounts ON accounts.company_id = jobs.company_id AND accounts.id = jobs.connection_id
			WHERE jobs.company_id = $1 AND jobs.id = $2 AND jobs.status = 'published' AND accounts.is_stand_in
			FOR SHARE OF jobs`
		var id string
		if err := tx.QueryRow(ctx, lock, company.String(), jobID).Scan(&id); errors.Is(err, pgx.ErrNoRows) {
			return nil
		} else if err != nil {
			return err
		}
		const insert = `
			INSERT INTO post_metrics (company_id, publish_job_id, collected_at, views, reach, reactions, comments, shares, clicks, video_views, source)
			VALUES ($1, $2, now(), $3, $4, $5, $6, $7, $8, $9, 'dev_simulated')`
		_, err := tx.Exec(ctx, insert, company.String(), jobID, columns["views"], columns["reach"], columns["reactions"],
			columns["comments"], columns["shares"], columns["clicks"], columns["video_views"])
		saved = err == nil
		return err
	})
	return saved, err
}
