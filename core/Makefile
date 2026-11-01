# The commands to work on core. Run them from the core/ folder.

.PHONY: test check run simulate simulate-post-metrics

# Every test. Database tests use TEST_DATABASE_URL from ../.env.core (the
# local database; they write and delete their own rows), else they are skipped.
test:
	@if [ -f ../.env.core ]; then set -a && . ../.env.core && set +a; fi; go test ./...

# Formatting, Go's own checks and every test run fresh (-count=1: the
# tenant check reads every Go file, and a cached result misses a new one).
# Run before every commit.
check:
	@test -z "$$(gofmt -l .)" || (echo "Run gofmt -w . first" && gofmt -l . && exit 1)
	go vet ./...
	@if [ -f ../.env.core ]; then set -a && . ../.env.core && set +a; fi; go test -count=1 ./...

# Starts core with the settings in ../.env.core (never committed).
run:
	set -a && . ../.env.core && set +a && go run ./cmd/core

# A stand-in customer's message (development, local database only), e.g.
# make simulate OWNER=you@example.com NAME="Lena" TEXT="Are you open tonight?"
simulate:
	set -a && . ../.env.core && set +a && go run ./cmd/simulate message "$(OWNER)" "$(NAME)" "$(TEXT)"

# Made-up numbers for a development stand-in's published post (development,
# local database only), e.g.
# make simulate-post-metrics JOB=<publish job id> NUMBERS="views=120 reactions=8"
simulate-post-metrics:
	set -a && . ../.env.core && set +a && go run ./cmd/simulate post-metrics "$(JOB)" $(NUMBERS)
