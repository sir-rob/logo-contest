.PHONY: help dev emulators seed build test typecheck lint format clean bootstrap deploy deploy-dry infra-plan infra-fmt

help:
	@echo "dev        - emulators + api + web"
	@echo "emulators  - Firebase emulator suite only"
	@echo "seed       - seed emulators with fake users/entries/ballots"
	@echo "test       - run all tests"
	@echo "typecheck  - tsc across the workspace"
	@echo ""
	@echo "Deployment (requires PROJECT_ID=...):"
	@echo "bootstrap  - first-time setup of a new Argolis project"
	@echo "deploy-dry - show what a deploy would do, change nothing"
	@echo "deploy     - build, push, terraform apply, deploy hosting"
	@echo "infra-plan - terraform plan only"
	@echo "infra-fmt  - terraform fmt the infra/ directory"

dev:
	npx concurrently -n emu,api,web -c yellow,cyan,magenta "npm run emulators" "npm run dev:api" "npm run dev:web"

emulators:
	npm run emulators

seed:
	npm run seed

build:
	npm run build

test:
	npx vitest run

typecheck:
	npx tsc -b --pretty

lint:
	npx eslint . --ext .ts,.tsx

format:
	npx prettier --write "**/*.{ts,tsx,json,md,css}"

clean:
	rm -rf apps/*/dist packages/*/dist coverage .emulator-data

# ---------------------------------------------------------------------------
# Deployment targets.
#
# All of these require PROJECT_ID, e.g.:
#   make deploy PROJECT_ID=n7-logo-contest
#
# They are thin wrappers over scripts/bootstrap.sh and scripts/deploy.sh --
# the scripts hold all the logic, so there is nothing here to drift out of
# sync with them. Read 03-DEPLOY-RUNBOOK.md and infra/README.md before the
# first run; the Domain Restricted Sharing org-policy exception is a manual
# prerequisite that no target here will do for you.
# ---------------------------------------------------------------------------

# Fail early and clearly rather than letting a script prompt for a project
# nobody meant to touch.
require-project:
	@test -n "$(PROJECT_ID)" || { \
		echo "PROJECT_ID is required, e.g. make $(MAKECMDGOALS) PROJECT_ID=n7-logo-contest"; \
		exit 2; \
	}
.PHONY: require-project

bootstrap: require-project
	./scripts/bootstrap.sh --project-id "$(PROJECT_ID)"

deploy-dry: require-project
	./scripts/deploy.sh --project-id "$(PROJECT_ID)" --dry-run

deploy: require-project
	./scripts/deploy.sh --project-id "$(PROJECT_ID)"

infra-plan: require-project
	terraform -chdir=infra plan -var="project_id=$(PROJECT_ID)"

infra-fmt:
	terraform -chdir=infra fmt -recursive
