SHELL := /bin/bash
.DEFAULT_GOAL := help

MOCKS      ?= asaas whatsapp generator sms
PROFILE    ?= generic
TARGET_ENV ?=
FORCE      ?=

PROFILES := $(foreach m,$(MOCKS),--profile $(m))
COMPOSE  := docker compose --env-file .env -f docker-compose.yml

export MOCKS PROFILE TARGET_ENV

.PHONY: help env setup setup-sandbox up down restart logs ps status build publish env-mock env-sandbox test clean video video-voice video-listen video-say video-try video-shots video-studio video-key

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
	generator_port=$$(sed -n 's/^GENERATOR_PORT=//p' .env | tail -n1); generator_port=$${generator_port:-45450}; \
	sms_port=$$(sed -n 's/^SMS_PORT=//p' .env | tail -n1); sms_port=$${sms_port:-3020}; \
	for entry in asaas:$$asaas_port whatsapp:$$whatsapp_port generator:$$generator_port sms:$$sms_port; do \
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

test: ## Run the tests of the mocks, one after the other
	@cd mocks/asaas && bun test
	@cd mocks/whatsapp && bun run test
	@cd mocks/generator && bun test
	@cd mocks/sms && bun test

video: video-voice ## Render the film and ask where to save it (default: the Desktop)
	@if [ -n "$(out)" ]; then dest="$(out)"; \
	else read -r -p "Save the film where? [$(HOME)/Desktop/ama4devs-asaas-mock.mp4]: " answer; \
	dest="$${answer:-$(HOME)/Desktop/ama4devs-asaas-mock.mp4}"; fi; \
	mkdir -p "$$(dirname "$$dest")"; \
	echo "Rendering to $$dest"; \
	cd video && bun run render "$$dest"

video-voice: ## Regenerate the narration and listen to it (reads .env.sandbox; needs the MCP connector)
	@if [ -f .env.sandbox ]; then set -a; . ./.env.sandbox; set +a; fi; \
	cd video && node scripts/voice.mjs --require-engine
	@$(MAKE) video-listen

video-listen: ## Listen to the generated narration and report what it heard (needs mcode-tools)
	@command -v mcode-tools >/dev/null 2>&1 || \
		{ echo "mcode-tools not found: the narration was generated, but nobody listened to it."; \
		  echo "The check is part of the build: install the MCP connector and run it again."; exit 1; }; \
	cd video && node scripts/listen.mjs

video-key: ## Set up the voice key (ElevenLabs first, OpenRouter second): make video-key [engine=elevenlabs]
	@scripts/voice-key.sh $(engine)

video-say: ## Speak one line: make video-say text="..." [duration=4.5] [pace=1] [at=12.4] [id=recusa]
	@if [ -f .env.sandbox ]; then set -a; . ./.env.sandbox; set +a; fi; \
	node video/scripts/say.mjs --text "$(text)" \
		$(if $(duration),--duration $(duration)) \
		$(if $(pace),--pace $(pace)) \
		$(if $(at),--at $(at)) \
		$(if $(id),--id $(id)) \
		$(if $(voice),--voice $(voice))

video-try: ## Try the voice with the v4 options, saved to the Desktop: make video-try text="..." [name=meu-teste]
	@if [ -f .env.sandbox ]; then set -a; . ./.env.sandbox; set +a; fi; \
	node video/scripts/try-voice.mjs --text "$(text)" \
		$(if $(name),--name $(name)) \
		$(if $(model),--model $(model)) \
		$(if $(voice),--voice $(voice)) \
		$(if $(style),--style $(style)) \
		$(if $(language),--language $(language)) \
		$(if $(filter),--filter $(filter)) \
		$(if $(room),--room $(room)) \
		$(if $(noise),--noise $(noise)) \
		$(if $(seed),--seed $(seed)) \
		$(if $(pace),--pace $(pace))

video-shots: ## Capture the screens of the running mock for the film (needs the mocks up)
	@cd video && node scripts/capture.mjs

video-studio: ## Preview the film with the scrubber at http://localhost:3000
	@cd video && bun run studio

clean: env ## Remove containers and volumes (FORCE=1 skips the prompt)
	@if [ "$(FORCE)" != "1" ]; then \
		read -r -p "This deletes the mock containers and their data. Continue? [y/N] " ans; \
		case "$$ans" in y | Y) ;; *) echo "Aborted."; exit 1 ;; esac; \
	fi
	@$(COMPOSE) $(PROFILES) down -v
