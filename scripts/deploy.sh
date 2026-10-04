#!/usr/bin/env bash
#
# deploy.sh -- build and deploy the N7 logo contest.
#
# Pipeline, in order:
#   1. build the API container image
#   2. push it to Artifact Registry
#   3. terraform apply with the new image tag
#   4. build the web bundle
#   5. firebase deploy --only hosting,firestore:rules,storage:rules
#
# Run scripts/bootstrap.sh first on a new project. This script assumes the
# APIs are on and the DRS org-policy exception is in place.
#
# Output is plain text with no colour escapes so it reads correctly in a CI
# log or a piped file.

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA_DIR="${REPO_ROOT}/infra"

# ---------------------------------------------------------------------------
# Defaults -- overridable by flags
# ---------------------------------------------------------------------------
PROJECT_ID="${PROJECT_ID:-}"
REGION="us-east4"
SERVICE_NAME="contest-api"
REPOSITORY_ID="contest"
DRY_RUN="false"
ALLOW_DIRTY="false"
SKIP_BUILD="false"
SKIP_INFRA="false"
SKIP_WEB="false"
AUTO_APPROVE="false"
IMAGE_TAG=""

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
log()  { printf '[deploy] %s\n' "$*"; }
warn() { printf '[deploy] WARNING: %s\n' "$*" >&2; }
die()  { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }
rule() { printf -- '---------------------------------------------------------------------------\n'; }

step() {
  printf '\n'
  rule
  printf '[deploy] %s\n' "$*"
  rule
}

# Echo a command, and run it unless this is a dry run.
run() {
  printf '[deploy] $ %s\n' "$*"
  if [[ "${DRY_RUN}" == "true" ]]; then
    return 0
  fi
  "$@"
}

usage() {
  cat <<USAGE
${SCRIPT_NAME} -- build and deploy the N7 logo contest.

Usage:
  ${SCRIPT_NAME} --project-id PROJECT_ID [options]

Required:
  --project-id ID       Target Google Cloud project.
                        May also be supplied via the PROJECT_ID env var.

Options:
  --region REGION       Default: ${REGION}
  --service NAME        Cloud Run service name. Default: ${SERVICE_NAME}
                        MUST match the serviceId in firebase.json.
  --repository ID       Artifact Registry repo. Default: ${REPOSITORY_ID}
  --tag TAG             Override the image tag. Default: git short SHA.
                        "latest" is rejected -- see the note below.
  --dry-run             Print every command without running any of them.
  --allow-dirty         Permit a deploy from a dirty working tree.
  --skip-build          Reuse the existing image for the current tag.
  --skip-infra          Do not run terraform apply.
  --skip-web            Do not build or deploy the web bundle.
  --auto-approve        Pass -auto-approve to terraform apply.
                        Intended for CI. Think before using it by hand.
  -h, --help            Show this help.

WHY THE GIT SHA AND NEVER "latest":
  A rollback needs an IMMUTABLE reference. ":latest" is a moving pointer --
  by the time you need to roll back, it points at the broken build you are
  trying to escape, and the Cloud Run revision that "worked" no longer
  resolves to the bytes that worked. With a SHA tag, rolling back is:

      terraform -chdir=infra apply -var="api_image=...:PREVIOUS_SHA"

  and the image is exactly, provably, the one that was running.

Examples:
  ${SCRIPT_NAME} --project-id n7-logo-contest --dry-run
  ${SCRIPT_NAME} --project-id n7-logo-contest
  ${SCRIPT_NAME} --project-id n7-logo-contest --skip-infra --skip-build
USAGE
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-id)  [[ $# -ge 2 ]] || die "--project-id requires a value"; PROJECT_ID="$2"; shift 2 ;;
    --project-id=*) PROJECT_ID="${1#*=}"; shift ;;
    --region)      [[ $# -ge 2 ]] || die "--region requires a value"; REGION="$2"; shift 2 ;;
    --region=*)    REGION="${1#*=}"; shift ;;
    --service)     [[ $# -ge 2 ]] || die "--service requires a value"; SERVICE_NAME="$2"; shift 2 ;;
    --service=*)   SERVICE_NAME="${1#*=}"; shift ;;
    --repository)  [[ $# -ge 2 ]] || die "--repository requires a value"; REPOSITORY_ID="$2"; shift 2 ;;
    --repository=*) REPOSITORY_ID="${1#*=}"; shift ;;
    --tag)         [[ $# -ge 2 ]] || die "--tag requires a value"; IMAGE_TAG="$2"; shift 2 ;;
    --tag=*)       IMAGE_TAG="${1#*=}"; shift ;;
    --dry-run)     DRY_RUN="true"; shift ;;
    --allow-dirty) ALLOW_DIRTY="true"; shift ;;
    --skip-build)  SKIP_BUILD="true"; shift ;;
    --skip-infra)  SKIP_INFRA="true"; shift ;;
    --skip-web)    SKIP_WEB="true"; shift ;;
    --auto-approve) AUTO_APPROVE="true"; shift ;;
    -h|--help)     usage; exit 0 ;;
    *)
      printf 'Unknown argument: %s\n\n' "$1" >&2
      usage >&2
      exit 2 ;;
  esac
done

[[ -n "${PROJECT_ID}" ]] || { usage >&2; die "--project-id is required (or set PROJECT_ID)."; }

if [[ "${DRY_RUN}" == "true" ]]; then
  log "DRY RUN -- commands are printed, nothing is executed."
fi

# ---------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------
step "1/7  Preflight"

for bin in git docker gcloud terraform node npm firebase; do
  command -v "${bin}" >/dev/null 2>&1 || die "required tool not found: ${bin}"
done
log "all required tools present"

cd "${REPO_ROOT}"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not inside a git repository"

# --- Dirty working tree check --------------------------------------------
# A dirty tree means the git SHA in the image tag does NOT describe the code
# in the image. That silently destroys the one property the SHA tagging
# scheme exists to provide, so it is a hard failure by default.
if [[ -n "$(git status --porcelain)" ]]; then
  if [[ "${ALLOW_DIRTY}" == "true" ]]; then
    warn "Working tree is DIRTY and --allow-dirty was given."
    warn "The image tag will NOT accurately describe the deployed code."
    warn "Uncommitted changes:"
    git status --short | sed 's/^/[deploy]   /'
  else
    printf '\n' >&2
    git status --short | sed 's/^/[deploy]   /' >&2
    printf '\n' >&2
    die "Working tree is dirty. Commit or stash first, or pass --allow-dirty.
       Images are tagged with the git SHA so that a rollback references
       exact bytes; deploying uncommitted code breaks that guarantee."
  fi
fi

GIT_SHA="$(git rev-parse --short=7 HEAD)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [[ -z "${IMAGE_TAG}" ]]; then
  IMAGE_TAG="${GIT_SHA}"
  if [[ "${ALLOW_DIRTY}" == "true" && -n "$(git status --porcelain)" ]]; then
    # Mark the tag so a dirty build is never mistaken for a reproducible one.
    IMAGE_TAG="${GIT_SHA}-dirty"
  fi
fi

if [[ "${IMAGE_TAG}" == "latest" ]]; then
  die "Refusing to tag an image 'latest'. A rollback needs an immutable reference."
fi

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY_ID}"
IMAGE_URI="${REGISTRY}/${SERVICE_NAME}:${IMAGE_TAG}"

log "project    : ${PROJECT_ID}"
log "region     : ${REGION}"
log "service    : ${SERVICE_NAME}"
log "git        : ${GIT_BRANCH} @ ${GIT_SHA}"
log "image      : ${IMAGE_URI}"

# --- firebase.json / Cloud Run coupling check ------------------------------
# Hosting rewrites /api/** to a service by name. If firebase.json and this
# deploy disagree, API calls quietly return index.html and you lose an hour.
if [[ -f "${REPO_ROOT}/firebase.json" ]]; then
  if ! grep -q "\"serviceId\": \"${SERVICE_NAME}\"" "${REPO_ROOT}/firebase.json"; then
    warn "firebase.json does not appear to rewrite /api/** to serviceId '${SERVICE_NAME}'."
    warn "If they disagree, API requests will be served the SPA shell instead."
  else
    log "firebase.json rewrite target matches '${SERVICE_NAME}'"
  fi
else
  warn "firebase.json not found at repo root; hosting deploy will fail."
fi

# ---------------------------------------------------------------------------
# 2. Build the API image
# ---------------------------------------------------------------------------
step "2/7  Build API container image"

if [[ "${SKIP_BUILD}" == "true" ]]; then
  log "--skip-build given; assuming ${IMAGE_URI} already exists."
else
  # Build context is the REPO ROOT, not apps/api: this is an npm workspace
  # and the Dockerfile needs the root package-lock.json and packages/shared.
  # .dockerignore keeps the context small despite that.
  run docker build \
    --file "apps/api/Dockerfile" \
    --tag "${IMAGE_URI}" \
    --platform "linux/amd64" \
    --build-arg "GIT_SHA=${GIT_SHA}" \
    "${REPO_ROOT}"
  # --platform linux/amd64 is explicit because Cloud Run does not run arm64
  # images, and an Apple Silicon laptop will happily build one that fails at
  # deploy time with a confusing "container failed to start".
fi

# ---------------------------------------------------------------------------
# 3. Push to Artifact Registry
# ---------------------------------------------------------------------------
step "3/7  Push image to Artifact Registry"

if [[ "${SKIP_BUILD}" == "true" ]]; then
  log "--skip-build given; skipping push."
else
  log "configuring docker credentials for ${REGION}-docker.pkg.dev"
  run gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
  run docker push "${IMAGE_URI}"
fi

# ---------------------------------------------------------------------------
# 4. Terraform apply
# ---------------------------------------------------------------------------
step "4/7  Terraform apply"

if [[ "${SKIP_INFRA}" == "true" ]]; then
  log "--skip-infra given; skipping terraform."
else
  [[ -d "${INFRA_DIR}" ]] || die "infra/ not found at ${INFRA_DIR}"

  if [[ ! -f "${INFRA_DIR}/terraform.tfvars" ]]; then
    die "infra/terraform.tfvars not found.
       cp infra/terraform.tfvars.example infra/terraform.tfvars and fill it in."
  fi

  run terraform -chdir="${INFRA_DIR}" init -input=false
  run terraform -chdir="${INFRA_DIR}" validate

  TF_ARGS=(
    -input=false
    -var "project_id=${PROJECT_ID}"
    -var "region=${REGION}"
    -var "service_name=${SERVICE_NAME}"
    -var "api_image=${IMAGE_URI}"
  )

  if [[ "${DRY_RUN}" == "true" ]]; then
    # A dry run still shows a real plan where it can -- that is the useful
    # part. But `run` did not actually execute the init above, so only
    # attempt a plan if the directory was initialised by a previous run.
    if [[ -d "${INFRA_DIR}/.terraform" ]]; then
      log "dry run: showing plan instead of applying"
      terraform -chdir="${INFRA_DIR}" plan "${TF_ARGS[@]}" || \
        warn "plan failed (expected if the project is not reachable from here)"
    else
      log "dry run: infra/ is not initialised, skipping plan"
      log "         run 'terraform -chdir=infra init' first to see a real plan"
    fi
  else
    if [[ "${AUTO_APPROVE}" == "true" ]]; then
      terraform -chdir="${INFRA_DIR}" apply -auto-approve "${TF_ARGS[@]}"
    else
      terraform -chdir="${INFRA_DIR}" apply "${TF_ARGS[@]}"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 5. Build the web bundle
# ---------------------------------------------------------------------------
step "5/7  Build web bundle"

if [[ "${SKIP_WEB}" == "true" ]]; then
  log "--skip-web given; skipping web build."
else
  if [[ ! -d "${REPO_ROOT}/node_modules" ]]; then
    log "node_modules missing; installing workspace dependencies"
    run npm ci
  fi
  run npm run build --workspace @contest/web
fi

# ---------------------------------------------------------------------------
# 6. Firebase deploy
# ---------------------------------------------------------------------------
step "6/7  Firebase deploy (hosting + rules)"

if [[ "${SKIP_WEB}" == "true" ]]; then
  log "--skip-web given; skipping firebase deploy."
else
  # Hosting AND the security rules. Both are CLI-managed by design:
  #   * hosting -- see infra/hosting.tf for why it is not in Terraform
  #   * rules   -- firestore.rules / storage.rules are deny-everything files
  #                that the Firebase tooling and the emulator already read
  #
  # NOT deployed here: firestore:indexes. Terraform owns those (it reads
  # firestore.indexes.json directly), and deploying them from both tools
  # would put Terraform into a permanent fight with the CLI.
  run firebase deploy \
    --project "${PROJECT_ID}" \
    --only "hosting,firestore:rules,storage:rules" \
    --non-interactive
fi

# ---------------------------------------------------------------------------
# 7. Summary
# ---------------------------------------------------------------------------
step "7/7  Summary"

SERVICE_URL="(unknown)"
BUCKET_NAME="(unknown)"
SA_EMAIL="(unknown)"
if [[ "${DRY_RUN}" != "true" && "${SKIP_INFRA}" != "true" ]]; then
  SERVICE_URL="$(terraform -chdir="${INFRA_DIR}" output -raw api_service_url 2>/dev/null || echo "(unavailable)")"
  BUCKET_NAME="$(terraform -chdir="${INFRA_DIR}" output -raw storage_bucket_name 2>/dev/null || echo "(unavailable)")"
  SA_EMAIL="$(terraform -chdir="${INFRA_DIR}" output -raw api_service_account_email 2>/dev/null || echo "(unavailable)")"
fi

rule
if [[ "${DRY_RUN}" == "true" ]]; then
  printf '  DRY RUN -- nothing above was executed.\n'
fi
printf '  Project         : %s\n' "${PROJECT_ID}"
printf '  Region          : %s\n' "${REGION}"
printf '  Commit          : %s (%s)\n' "${GIT_SHA}" "${GIT_BRANCH}"
printf '  Image           : %s\n' "${IMAGE_URI}"
printf '  Cloud Run       : %s\n' "${SERVICE_NAME}"
printf '  Service URL     : %s\n' "${SERVICE_URL}"
printf '  Image bucket    : %s\n' "${BUCKET_NAME}"
printf '  Runtime SA      : %s\n' "${SA_EMAIL}"
printf '  Hosting         : %s\n' "$([[ "${SKIP_WEB}" == "true" ]] && echo "skipped" || echo "https://${PROJECT_ID}.web.app")"
printf '  Rules deployed  : %s\n' "$([[ "${SKIP_WEB}" == "true" ]] && echo "skipped" || echo "firestore.rules, storage.rules")"
rule

if [[ "${DRY_RUN}" != "true" ]]; then
  cat <<NEXT
  To roll back to this exact build later:

    terraform -chdir=infra apply -var="api_image=${IMAGE_URI}"

  Before inviting anyone, work through the smoke test in
  03-DEPLOY-RUNBOOK.md section 7 -- in particular: sign in with a SECOND
  on-domain account, and confirm an uploaded object has a UUID name and no
  EXIF.

NEXT
fi
