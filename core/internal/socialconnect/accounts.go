package socialconnect

import (
	"context"
	"sort"
	"time"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/platforms"
	"ansa/core/internal/tenant"
)

// AccountsPage is what the Accounts page shows (the old
// services/social-accounts.ts): per platform, what ansa publishes there,
// whether ansa set it up, and the company's accounts with their status as
// of now. Never a token. Each platform's own facts (media, scheduling,
// what it takes to set up) are the screens' text (lib/social-platforms.ts).
type AccountsPage struct {
	CanManage bool `json:"canManage"`
	// Development only: notes for ansa's own operator.
	ShowsOperatorNotes bool           `json:"showsOperatorNotes"`
	Platforms          []PlatformView `json:"platforms"`
}

// PlatformView is one platform on the page.
type PlatformView struct {
	Platform    string   `json:"platform"`
	Label       string   `json:"label"`
	Mode        string   `json:"mode"`
	AccountKind string   `json:"accountKind"`
	Publishes   string   `json:"publishes"`
	TextLimit   string   `json:"textLimit"`
	ScopesAsked []string `json:"scopesAsked"`
	// Whether a Disconnect has the platform take ansa's access back (X, Google).
	RevokesOnRequest bool `json:"revokesOnRequest"`
	// Development only: the settings that would set it up (never named in
	// production, where customers can't do anything about them).
	MissingSettings *AppSettings     `json:"missingSettings"`
	Connections     []ConnectionView `json:"connections"`
	Disconnected    []ConnectionView `json:"disconnected"`
}

// AppSettings name a platform app's two settings.
type AppSettings struct {
	ID     string `json:"id"`
	Secret string `json:"secret"`
}

// ConnectionView is one connection, its status as of now.
type ConnectionView struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	AccountKind string `json:"accountKind"`
	Status      string `json:"status"`
	// Why it needs attention: its code, and the words the page shows.
	ProblemCode     *string    `json:"problemCode"`
	Problem         *string    `json:"problem"`
	Scopes          []string   `json:"scopes"`
	Lifetime        Lifetime   `json:"lifetime"`
	IsStandIn       bool       `json:"isStandIn"`
	ConnectedAt     time.Time  `json:"connectedAt"`
	ConnectedByName *string    `json:"connectedByName"`
	DisconnectedAt  *time.Time `json:"disconnectedAt"`
}

// Lifetime is how long a connection's access lasts as of now. Kind
// "stand-in"; "no-end-date"; "renews-itself" (ansa renews it until Until,
// the refresh token's own end when the platform named one); "runs-out"
// (On: nothing can renew it, an owner reconnects before then); "ran-out"
// (On has passed); "none" (it needs a reconnect for another reason).
type Lifetime struct {
	Kind  string     `json:"kind"`
	Until *time.Time `json:"until"`
	On    *time.Time `json:"on"`
}

var appSettingNames = map[string]AppSettings{
	"linkedin": {"LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"}, "facebook": {"FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"},
	"x": {"X_CLIENT_ID", "X_CLIENT_SECRET"}, "youtube": {"GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"},
}

// AccountsPage reads the company's Accounts page as of now. Members read
// it too (isOwner = whether they may connect and disconnect).
func (c *Connector) AccountsPage(ctx context.Context, company tenant.CompanyID, isOwner bool) (AccountsPage, error) {
	listed, err := listConnections(ctx, c.Pool, company)
	if err != nil {
		return AccountsPage{}, err
	}
	now := time.Now()
	page := AccountsPage{CanManage: isOwner, ShowsOperatorNotes: c.Development, Platforms: []PlatformView{}}
	for _, platform := range contentrules.Platforms {
		view := c.platformView(platform)
		for _, connection := range listed {
			if connection.platform != platform {
				continue
			}
			if shown := connectionView(connection, now); shown.Status == "disconnected" {
				view.Disconnected = append(view.Disconnected, shown)
			} else {
				view.Connections = append(view.Connections, shown)
			}
		}
		// Connected ones first, then those needing a reconnect; each by name.
		sort.SliceStable(view.Connections, func(i, j int) bool {
			return view.Connections[i].Status == "connected" && view.Connections[j].Status != "connected"
		})
		page.Platforms = append(page.Platforms, view)
	}
	return page, nil
}

func (c *Connector) platformView(platform string) PlatformView {
	view := PlatformView{Platform: platform, Label: contentrules.PlatformLabels[platform], Mode: c.Mode(platform), AccountKind: platforms.AccountKinds[platform],
		Publishes: describePublishedFormats(platform), TextLimit: describeTextLimit(platform), ScopesAsked: platforms.Scopes(platform),
		RevokesOnRequest: contentrules.RevokesOnRequest[platform], Connections: []ConnectionView{}, Disconnected: []ConnectionView{}}
	if platform == "facebook" {
		view.ScopesAsked = append([]string{}, allScopes...)
	}
	if view.Mode == "stand-in" {
		settings := appSettingNames[platform]
		view.MissingSettings = &settings
	}
	return view
}

// connectionView is one connection as the page shows it, as of now.
func connectionView(c listedConnection, now time.Time) ConnectionView {
	status := c.statusAsOfNow(now)
	problemCode := c.lastError
	if c.hasRunOut(now) {
		code := "token_expired"
		if c.hasRefreshToken {
			code = "refresh_expired"
		}
		problemCode = &code
	}
	view := ConnectionView{ID: c.id, DisplayName: c.displayName, AccountKind: c.accountKind, Status: status, Scopes: c.scopes,
		Lifetime: lifetimeOf(c, status, now), IsStandIn: c.isStandIn, ConnectedAt: c.connectedAt, ConnectedByName: c.connectedByName,
		DisconnectedAt: c.disconnectedAt}
	if problemCode != nil {
		words := describeConnectionError(*problemCode, contentrules.PlatformLabels[c.platform])
		view.ProblemCode, view.Problem = problemCode, &words
	}
	return view
}

// lifetimeOf is how long the access lasts as of now. "ran out on" only
// for a date that has passed.
func lifetimeOf(c listedConnection, status string, now time.Time) Lifetime {
	ends := c.accessExpiresAt
	switch {
	case c.isStandIn:
		return Lifetime{Kind: "stand-in"}
	case status != "connected" && ends != nil && !ends.After(now) && !c.renewsItself(now):
		// The problem says why; an end that has passed is all there is to add.
		return Lifetime{Kind: "ran-out", On: ends}
	case status != "connected":
		return Lifetime{Kind: "none"}
	case ends == nil:
		return Lifetime{Kind: "no-end-date"}
	case c.renewsItself(now):
		return Lifetime{Kind: "renews-itself", Until: c.refreshExpiresAt}
	}
	return Lifetime{Kind: "runs-out", On: ends}
}
