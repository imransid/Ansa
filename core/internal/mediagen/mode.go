package mediagen

// Mode is which service makes images and videos on this server: Provider
// nil = "off" (production without a real service: nothing is asked for,
// and the pages say it isn't set up).
type Mode struct {
	Provider Provider
}

// ModeFor is the mode for the MEDIA_PROVIDER setting ("" or "dev-stand-in",
// checked at start) on a production server or not. Unset in development is
// the stand-in; a stand-in in production is refused (off), even when named.
func ModeFor(setting string, production bool) Mode {
	var provider Provider
	switch {
	case setting == StandInName:
		provider = StandIn{}
	case setting == "" && !production:
		provider = StandIn{}
	}
	if provider == nil || (provider.IsStandIn() && production) {
		return Mode{}
	}
	return Mode{Provider: provider}
}

// ProviderForJob is the service a job was asked of, while this server
// still uses it: a stand-in's job is never run by a production server, and
// one made before MEDIA_PROVIDER changed is not sent to another service.
func (m Mode) ProviderForJob(name string) Provider {
	if m.Provider == nil || m.Provider.Name() != name {
		return nil
	}
	return m.Provider
}

// Availability is what the pages say about generation here.
type Availability struct {
	Available  bool `json:"available"`
	IsStandIn  bool `json:"isStandIn"`
	MakesVideo bool `json:"makesVideo"`
}

// Availability says whether anyone can be asked, whether that is the
// development stand-in, and whether it makes videos too.
func (m Mode) Availability() Availability {
	if m.Provider == nil {
		return Availability{}
	}
	makesVideo := false
	for _, kind := range m.Provider.Kinds() {
		makesVideo = makesVideo || kind == "video"
	}
	return Availability{Available: true, IsStandIn: m.Provider.IsStandIn(), MakesVideo: makesVideo}
}
