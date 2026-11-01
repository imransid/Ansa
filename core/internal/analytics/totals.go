package analytics

// The Analytics page's totals per platform (the old lib/analytics/totals.ts):
// for each number, the sum over the period's posts whose newest snapshot
// has it. A post without the number adds nothing (it is not 0), and a
// number the platform doesn't give says so instead of showing 0.

// MetricTotal is one number of one platform. Kind: "total" (Value, and how
// many Posts had it), "not_offered" (the platform has no such number),
// "not_collected" (only with Permission, which ansa doesn't ask for) or
// "no_numbers_yet" (ansa reads it, and no post of the period has it yet).
type MetricTotal struct {
	Kind       string `json:"kind"`
	Value      *int64 `json:"value,omitempty"`
	Posts      *int   `json:"posts,omitempty"`
	Permission string `json:"permission,omitempty"`
}

// PlatformTotals are one platform's totals; Simulated: some of the numbers
// were simulated (development).
type PlatformTotals struct {
	Platform         string                 `json:"platform"`
	Posts            int                    `json:"posts"`
	PostsWithNumbers int                    `json:"postsWithNumbers"`
	Simulated        bool                   `json:"simulated"`
	Metrics          map[string]MetricTotal `json:"metrics"`
}

// TotalsByPlatform has one entry per platform with posts in the period, in
// the platforms' order.
func TotalsByPlatform(posts []PublishedPost) []PlatformTotals {
	totals := []PlatformTotals{}
	for _, platform := range Platforms {
		var ofPlatform []PublishedPost
		for _, post := range posts {
			if post.Platform == platform {
				ofPlatform = append(ofPlatform, post)
			}
		}
		if len(ofPlatform) > 0 {
			totals = append(totals, totalsOf(platform, ofPlatform))
		}
	}
	return totals
}

func totalsOf(platform string, posts []PublishedPost) PlatformTotals {
	var snapshots []*LatestMetrics
	simulated := false
	for _, post := range posts {
		if post.Latest != nil {
			snapshots = append(snapshots, post.Latest)
			simulated = simulated || post.Latest.Source == "dev_simulated"
		}
	}
	metrics := map[string]MetricTotal{}
	for _, column := range MetricColumns {
		metrics[column] = totalOf(platform, column, snapshots)
	}
	return PlatformTotals{Platform: platform, Posts: len(posts), PostsWithNumbers: len(snapshots), Simulated: simulated, Metrics: metrics}
}

func totalOf(platform, column string, snapshots []*LatestMetrics) MetricTotal {
	definition := Definitions[platform][column]
	if definition.Status == "not_offered" {
		return MetricTotal{Kind: "not_offered"}
	}
	var sum int64
	given := 0
	for _, snapshot := range snapshots {
		if value := snapshot.Values[column]; value != nil {
			sum += *value
			given++
		}
	}
	if given > 0 {
		return MetricTotal{Kind: "total", Value: &sum, Posts: &given}
	}
	if definition.Status == "needs_permission" {
		return MetricTotal{Kind: "not_collected", Permission: definition.Permission}
	}
	return MetricTotal{Kind: "no_numbers_yet"}
}
