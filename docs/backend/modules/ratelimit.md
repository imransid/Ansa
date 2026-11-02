# ratelimit (core/internal/ratelimit)

**What:** counts attempts per action and caller, in PostgreSQL (`rate_limits`).
**Rules:** one statement reads and writes the count (two requests at once
can't both see the old number); a window that ran out starts again; the
stored key is HMAC-SHA256 of `<action>:<identifier>` with a secret derived
from BETTER_AUTH_SECRET (`HMAC(secret, "ansa rate limit keys")`), identical to
the old backend, so the counters carried over when core took over. `TakeBack` removes
one attempt that shouldn't count (a login that worked).
**Tests:** `ratelimit_test.go`: the key equals the old backend's (a value its
own code computed, kept as a fixed example); counting over a rule and taking one back (live database).
