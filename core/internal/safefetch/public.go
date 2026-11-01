package safefetch

import "net/netip"

// Ranges a server that fetches a typed address must never reach: this
// machine, the hosting provider's network or its metadata service
// (169.254.169.254), private, shared, documentation, benchmark, multicast
// and reserved ranges (the old lib/public-address.ts).
var nonPublic = mustPrefixes(
	"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
	"192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
	"224.0.0.0/4", "240.0.0.0/4",
	// ::/96 covers :: (unspecified), ::1 (loopback) and the old IPv4-compatible
	// form; fec0::/10 is the old site-local range.
	"::/96", "fc00::/7", "fe80::/10", "fec0::/10", "ff00::/8", "2001:db8::/32",
)

// IPv6 ranges carrying an IPv4 address in their last 32 bits: IPv4-mapped
// (::ffff:10.0.0.1) and NAT64 (64:ff9b::10.0.0.1), checked as that address.
var carryIPv4 = mustPrefixes("::ffff:0:0/96", "64:ff9b::/96")

// IsPublic is true only for an address core may connect to.
func IsPublic(address netip.Addr) bool {
	if !address.IsValid() {
		return false
	}
	address = address.WithZone("")
	for _, prefix := range carryIPv4 {
		if prefix.Contains(address) {
			bytes := address.As16()
			address = netip.AddrFrom4([4]byte{bytes[12], bytes[13], bytes[14], bytes[15]})
			break
		}
	}
	for _, prefix := range nonPublic {
		if prefix.Contains(address) {
			return false
		}
	}
	return true
}

func mustPrefixes(texts ...string) []netip.Prefix {
	prefixes := make([]netip.Prefix, len(texts))
	for i, text := range texts {
		prefixes[i] = netip.MustParsePrefix(text)
	}
	return prefixes
}
