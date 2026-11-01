package config

// ansa's developer app on LinkedIn, X and YouTube (a Google Cloud OAuth
// client), each pair set together (the old lib/social-settings.ts).
// Without one, development offers a stand-in account and production says
// the platform isn't set up. Facebook's pair is FACEBOOK_APP_ID / _SECRET
// (Messenger shares it).

// socialAppPairs are each platform's two settings.
var socialAppPairs = [][2]string{
	{"LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"},
	{"X_CLIENT_ID", "X_CLIENT_SECRET"},
	{"GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"},
}

// readSocialApps reads the three pairs.
func readSocialApps(cfg *Config, getenv Getenv) {
	cfg.LinkedInClientID, cfg.LinkedInClientSecret = getenv("LINKEDIN_CLIENT_ID"), getenv("LINKEDIN_CLIENT_SECRET")
	cfg.XClientID, cfg.XClientSecret = getenv("X_CLIENT_ID"), getenv("X_CLIENT_SECRET")
	cfg.GoogleClientID, cfg.GoogleClientSecret = getenv("GOOGLE_CLIENT_ID"), getenv("GOOGLE_CLIENT_SECRET")
}

// socialAppProblems: half a pair would look set up and fail at every
// connection, so it stops the server.
func socialAppProblems(cfg Config) []string {
	values := map[string]string{
		"LINKEDIN_CLIENT_ID": cfg.LinkedInClientID, "LINKEDIN_CLIENT_SECRET": cfg.LinkedInClientSecret,
		"X_CLIENT_ID": cfg.XClientID, "X_CLIENT_SECRET": cfg.XClientSecret,
		"GOOGLE_CLIENT_ID": cfg.GoogleClientID, "GOOGLE_CLIENT_SECRET": cfg.GoogleClientSecret,
	}
	var problems []string
	for _, pair := range socialAppPairs {
		if (values[pair[0]] == "") != (values[pair[1]] == "") {
			problems = append(problems, pair[0]+" and "+pair[1]+" must be set together")
		}
	}
	return problems
}
