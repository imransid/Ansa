# The commands to work on core. Run them from the core/ folder.

.PHONY: test check run \
	link-phone-line unlink-phone-line show-forwarding-address replace-forwarding-address telegram-webhook \
	simulate simulate-message simulate-post-metrics simulate-vapi-call simulate-vapi-tool-call simulate-solved-call \
	try-brain simulate-inbound-email simulate-email-bounce simulate-telegram telegram-poll simulate-messenger seed-tickets

# Every test (or one folder's: make test PKG=./internal/commands/). Database
# tests use TEST_DATABASE_URL from ../.env.core (the local database; they
# write and delete their own rows), else they are skipped.
test:
	@if [ -f ../.env.core ]; then set -a && . ../.env.core && set +a; fi; go test $(or $(PKG),./...)

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

# ---------------------------------------------------------------------------
# ansa's operator (docs/backend/modules/commands.md). The commands read the
# environment first, then ../.env.core for what it doesn't set, so a setting
# on the command line wins: DATABASE_URL="<direct url>" make link-phone-line ...
# Each prints the company and changes nothing until YES=1 (--yes).

# make link-phone-line OWNER=owner@theircompany.com NUMBER=<vapi phone number id> [YES=1]
link-phone-line:
	go run ./cmd/operator link-phone-line "$(OWNER)" "$(NUMBER)" $(if $(YES),--yes)

# make unlink-phone-line OWNER=owner@theircompany.com NUMBER=<vapi phone number id> [YES=1]
unlink-phone-line:
	go run ./cmd/operator unlink-phone-line "$(OWNER)" "$(NUMBER)" $(if $(YES),--yes)

# INBOUND_EMAIL_DOMAIN=<production domain> make show-forwarding-address OWNER=owner@theircompany.com
show-forwarding-address:
	go run ./cmd/operator show-forwarding-address "$(OWNER)"

# INBOUND_EMAIL_DOMAIN=<production domain> make replace-forwarding-address OWNER=owner@theircompany.com [YES=1]
replace-forwarding-address:
	go run ./cmd/operator replace-forwarding-address "$(OWNER)" $(if $(YES),--yes)

# make telegram-webhook ACTION=set URL=https://<core's public address>   or   ACTION=remove
telegram-webhook:
	go run ./cmd/operator telegram-webhook $(ACTION) $(URL)

# ---------------------------------------------------------------------------
# Development tools: refused in production and against a database that
# isn't on this computer. CORE=<address> sends to another local core than
# CORE_LISTEN_ADDR's.

# A stand-in customer's message, e.g.
# make simulate-message OWNER=you@example.com NAME="Lena" TEXT="Are you open tonight?"
simulate-message:
	go run ./cmd/simulate message "$(OWNER)" "$(NAME)" "$(TEXT)"

# The same, by its older name.
simulate: simulate-message

# make simulate-post-metrics JOB=<publish job id> NUMBERS="views=120 reactions=8"
simulate-post-metrics:
	go run ./cmd/simulate post-metrics "$(JOB)" $(NUMBERS)

# make simulate-vapi-call NUMBER=<vapi phone number id> [VARIANT=all]
simulate-vapi-call:
	go run ./cmd/simulate vapi-call "$(NUMBER)" $(VARIANT) $(if $(CORE),--core "$(CORE)")

# make simulate-vapi-tool-call NUMBER=<vapi phone number id> QUESTION="When are you open?" [CALL=<vapi call id>] [END_CALL=1]
simulate-vapi-tool-call:
	go run ./cmd/simulate vapi-tool-call "$(NUMBER)" "$(QUESTION)" $(if $(CALL),--call "$(CALL)") $(if $(END_CALL),--end-call) $(if $(CORE),--core "$(CORE)")

# make simulate-solved-call OWNER=you@example.com NUMBER=<vapi phone number id>
simulate-solved-call:
	go run ./cmd/simulate solved-call "$(OWNER)" "$(NUMBER)"

# make try-brain OWNER=you@example.com CALL=<call id from the call page's address>
try-brain:
	go run ./cmd/simulate try-brain "$(OWNER)" "$(CALL)"

# make simulate-inbound-email TO=<owner email or forwarding address> [VARIANT=html-only]
simulate-inbound-email:
	go run ./cmd/simulate inbound-email "$(TO)" $(VARIANT) $(if $(CORE),--core "$(CORE)")

# make simulate-email-bounce FILE=<file in .dev-emails/> [KIND=complained]
simulate-email-bounce:
	go run ./cmd/simulate email-bounce "$(FILE)" $(KIND) $(if $(CORE),--core "$(CORE)")

# make simulate-telegram OWNER=you@example.com NAME="Lena" TEXT="Are you open tonight?"
simulate-telegram:
	go run ./cmd/simulate telegram "$(OWNER)" "$(NAME)" "$(TEXT)"

# A real development bot's messages, read without a public address: make telegram-poll
telegram-poll:
	go run ./cmd/simulate telegram-poll

# make simulate-messenger OWNER=you@example.com NAME="Lena" TEXT="Do you deliver?"
simulate-messenger:
	go run ./cmd/simulate messenger "$(OWNER)" "$(NAME)" "$(TEXT)"

# make seed-tickets OWNER=you@example.com
seed-tickets:
	go run ./cmd/simulate seed-tickets "$(OWNER)"
