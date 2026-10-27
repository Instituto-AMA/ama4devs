SHELL := /bin/bash
.DEFAULT_GOAL := help

MOCKS      ?= asaas whatsapp
PROFILE    ?= generic
TARGET_ENV ?=
FORCE      ?=

PROFILES := $(foreach m,$(MOCKS),--profile $(m))
COMPOSE  := docker compose --env-file .env -f docker-compose.yml

export MOCKS PROFILE TARGET_ENV

.PHONY: help env setup setup-sandbox up down restart logs ps status build publish env-mock env-sandbox test clean

help: ## List the targets
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

env: ## Create .env from .env.example (never overwrites)
	@if [ ! -f .env ]; then cp .env.example .env && echo "Created .env from .env.example"; fi

setup: ## Start the mocks and point TARGET_ENV at them (no credential needed)
	@scripts/setup.sh

setup-sandbox: ## Point TARGET_ENV at the official Asaas sandbox and Meta Graph API
	@scripts/setup-sandbox.sh

up: env ## Start the mocks
	@$(COMPOSE) $(PROFILES) up -d --wait --wait-timeout 120

down: env ## Stop the mocks
	@$(COMPOSE) $(PROFILES) down

restart: env ## Restart the mocks
	@$(COMPOSE) $(PROFILES) restart

logs: env ## Follow logs: make logs s=<service>
	@$(COMPOSE) $(PROFILES) logs -f --tail=100 $(s)

ps: env ## List the mock containers
	@$(COMPOSE) $(PROFILES) ps

status: env ## Health of each mock, one line each
	@asaas_port=$$(sed -n 's/^ASAAS_PORT=//p' .env | tail -n1); asaas_port=$${asaas_port:-45445}; \
	whatsapp_port=$$(sed -n 's/^WHATSAPP_PORT=//p' .env | tail -n1); whatsapp_port=$${whatsapp_port:-3010}; \
	for entry in asaas:$$asaas_port whatsapp:$$whatsapp_port; do \
		name=$${entry%%:*}; port=$${entry##*:}; \
		if curl --fail --silent --max-time 3 "http://localhost:$$port/health" >/dev/null; then \
			echo "$$name: up (http://localhost:$$port)"; \
		else \
			echo "$$name: down"; \
		fi; \
	done

build: env ## Build the mock images
	@$(COMPOSE) $(PROFILES) build

publish: ## Build amd64+arm64 and push to ghcr.io/instituto-ama: make publish MOCKS=asaas (needs docker login ghcr.io; the publish-mocks workflow does this on every push to master)
	@scripts/publish.sh $(MOCKS)

env-mock: ## Write the mock env keys into TARGET_ENV (or print them)
	@scripts/env-mode.sh $(PROFILE) mock $(TARGET_ENV)

env-sandbox: ## Write the sandbox env keys into TARGET_ENV (or print them)
	@scripts/env-mode.sh $(PROFILE) sandbox $(TARGET_ENV)

test: ## Run the tests of both mocks, one after the other
	@cd mocks/asaas && bun test
	@cd mocks/whatsapp && bun run test

clean: env ## Remove containers and volumes (FORCE=1 skips the prompt)
	@if [ "$(FORCE)" != "1" ]; then \
		read -r -p "This deletes the mock containers and their data. Continue? [y/N] " ans; \
		case "$$ans" in y | Y) ;; *) echo "Aborted."; exit 1 ;; esac; \
	fi
	@$(COMPOSE) $(PROFILES) down -v
