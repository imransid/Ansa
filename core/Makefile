# The commands to work on core. Run them from the core/ folder.

.PHONY: test check run

# Every test. Database tests use TEST_DATABASE_URL from ../.env.core (the
# local database; they write and delete their own rows), else they are skipped.
test:
	@if [ -f ../.env.core ]; then set -a && . ../.env.core && set +a; fi; go test ./...

# Formatting and Go's own checks (run before every commit).
check:
	@test -z "$$(gofmt -l .)" || (echo "Run gofmt -w . first" && gofmt -l . && exit 1)
	go vet ./...
	@if [ -f ../.env.core ]; then set -a && . ../.env.core && set +a; fi; go test ./...

# Starts core with the settings in ../.env.core (never committed).
run:
	set -a && . ../.env.core && set +a && go run ./cmd/core
