# safefetch (core/internal/safefetch)

**What:** fetching a web page someone typed the address of ("Import a web
page"), without letting that address reach anything private (SSRF), as the
old `lib/safe-fetch.ts` and `lib/public-address.ts`. The ONLY way core
fetches a typed address.

**Rules, in order:** https on the default port only (`port_not_allowed`), no
user name or password (`credentials_in_url`); the host resolved once, and
EVERY address public (`IsPublic`: not private, shared, loopback,
link-local (169.254.169.254, the cloud metadata service), documentation,
benchmark, multicast or reserved, IPv4-mapped and NAT64 forms read as their
IPv4 address; `private_address`); the connection goes to exactly a checked
address (a custom dial: a DNS answer that changes in between can't swap in
a private one), the certificate checked for the host; no cookies, no
proxy, no compression; every redirect (at most 3) checked the same way
(`bad_redirect`, `too_many_redirects`); 10 seconds in all (`timeout`); a
2xx answer only (`http_status`), text/html or text/plain only
(`wrong_type`), not compressed (`unsupported_encoding`), at most 2 MB
(`too_large`), decoded with the charset its server names (else UTF-8).
Never logs: the caller logs the code, never the address.

**Tests:** `fetch_test.go` (a fake internet: no test touches the network)
— which addresses are public; a page fetched through a redirect and decoded
from windows-1252; a non-page and a too-large page refused; http, a port,
credentials, a private literal, a host resolving to a private address, a
redirect to one, a redirect to http, a redirect loop and an unknown host
each refused, and nothing private ever dialed.
