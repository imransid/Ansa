# The commands to work on core. Run them from the core/ folder.

.PHONY: test check run

# Every test.
test:
	go test ./...

# Formatting and Go's own checks (run before every commit).
check:
	@test -z "$$(gofmt -l .)" || (echo "Run gofmt -w . first" && gofmt -l . && exit 1)
	go vet ./...
	go test ./...

# Starts core with the settings in ../.env.core (never committed).
run:
	set -a && . ../.env.core && set +a && go run ./cmd/core
