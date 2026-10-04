#!/usr/bin/env bash
#
# bootstrap.sh -- first-time setup for a NEW Argolis project.
#
# Run this once per project, before the first deploy. It is idempotent: run
# it again any time you want to re-check that the environment is sane.
#
# What it does NOT do, on purpose:
#   * create the GCP project or link billing  (runbook step 1 -- needs org
#     context and a billing account you may not be able to pick for someone)
#   * change any org policy                   (runbook step 2 -- see below)
#   * configure Firebase Auth                 (runbook step 5 -- console work)
#   * terraform apply                         (never without you saying so)
#
# Output is plain text with no colour escapes so it reads correctly in a CI
# log or a piped file.

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA_DIR="${REPO_ROOT}/infra"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
PROJECT_ID=""
REGION="us-east4"
TF_STATE_BUCKET=""
ASSUME_YES="false"
SKIP_TERRAFORM="false"

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
log()   { printf '[bootstrap] %s\n' "$*"; }
warn()  { printf '[bootstrap] WARNING: %s\n' "$*" >&2; }
die()   { printf '[bootstrap] ERROR: %s\n' "$*" >&2; exit 1; }
rule()  { printf -- '---------------------------------------------------------------------------\n'; }

step() {
  printf '\n'
  rule
  printf '[bootstrap] %s\n' "$*"
  rule
}

usage() {
  cat <<USAGE
${SCRIPT_NAME} -- first-time setup for a new Argolis project.

Usage:
  ${SCRIPT_NAME} --project-id PROJECT_ID [options]

Required:
  --project-id ID        Target Google Cloud project. Must already exist and
                         be linked to billing (deploy runbook step 1).

Options:
  --region REGION        Region for Cloud Run / Artifact Registry / bucket.
                         Default: ${REGION}
  --state-bucket NAME    Create (if absent) a GCS bucket for Terraform remote
                         state. Omit to use local state, which is the default
                         and is fine for a single operator.
  --yes                  Do not prompt for the project confirmation. The DRS
                         org-policy check is still enforced.
  --skip-terraform       Do prerequisite and API work only; skip init/plan.
  -h, --help             Show this help.

Order of operations:
  1. ${SCRIPT_NAME}      <- you are here
  2. Firebase Auth setup in the console (runbook step 5)
  3. scripts/deploy.sh

This script never runs 'terraform apply'.
USAGE
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-id)
      [[ $# -ge 2 ]] || die "--project-id requires a value"
      PROJECT_ID="$2"; shift 2 ;;
    --project-id=*)
      PROJECT_ID="${1#*=}"; shift ;;
    --region)
      [[ $# -ge 2 ]] || die "--region requires a value"
      REGION="$2"; shift 2 ;;
    --region=*)
      REGION="${1#*=}"; shift ;;
    --state-bucket)
      [[ $# -ge 2 ]] || die "--state-bucket requires a value"
      TF_STATE_BUCKET="$2"; shift 2 ;;
    --state-bucket=*)
      TF_STATE_BUCKET="${1#*=}"; shift ;;
    --yes|-y)
      ASSUME_YES="true"; shift ;;
    --skip-terraform)
      SKIP_TERRAFORM="true"; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      printf 'Unknown argument: %s\n\n' "$1" >&2
      usage >&2
      exit 2 ;;
  esac
done

[[ -n "${PROJECT_ID}" ]] || { usage >&2; die "--project-id is required."; }

# ---------------------------------------------------------------------------
# 1. Prerequisites
# ---------------------------------------------------------------------------
step "1/6  Checking prerequisites"

MISSING=()
check_tool() {
  local bin="$1" why="$2"
  if command -v "${bin}" >/dev/null 2>&1; then
    log "found   ${bin}"
  else
    MISSING+=("${bin} (${why})")
  fi
}

check_tool gcloud    "project, API and org-policy operations"
check_tool terraform "provisions everything inside the project"
check_tool firebase  "Hosting, Firestore rules, Storage rules"
check_tool node      "builds the API and the web bundle"
check_tool docker    "builds the API container image"

if [[ -n "${MISSING}" ]]; then
  printf '\n'
  log "Missing required tools:"
  printf '%s' "${MISSING}"
  die "Install the tools above and re-run."
fi

NODE_MAJOR="$(node --version | sed 's/^v//' | cut -d. -f1)"
if [[ "${NODE_MAJOR}" -lt 20 ]]; then
  die "Node 20+ required (found $(node --version)). The API targets Node 20."
fi
log "node version $(node --version) OK"

if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  die "No active gcloud credential. Run: gcloud auth login && gcloud auth application-default login"
fi
ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n1)"
log "authenticated as ${ACTIVE_ACCOUNT}"

# ---------------------------------------------------------------------------
# 2. Confirm the target project
# ---------------------------------------------------------------------------
step "2/6  Confirming target project"

if ! gcloud projects describe "${PROJECT_ID}" --format='value(projectId)' >/dev/null 2>&1; then
  cat <<EOF >&2

The project "${PROJECT_ID}" does not exist or you cannot see it.

Create it first (deploy runbook step 1):

  gcloud projects create "${PROJECT_ID}" --name="N7 Logo Contest" --organization=ORG_ID
  gcloud beta billing projects link "${PROJECT_ID}" --billing-account=BILLING_ACCOUNT

EOF
  die "Target project not reachable."
fi

PROJECT_NAME="$(gcloud projects describe "${PROJECT_ID}" --format='value(name)')"
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
log "project:  ${PROJECT_ID}  (${PROJECT_NAME}, number ${PROJECT_NUMBER})"
log "region:   ${REGION}"
log "account:  ${ACTIVE_ACCOUNT}"

BILLING_ENABLED="$(gcloud beta billing projects describe "${PROJECT_ID}" \
  --format='value(billingEnabled)' 2>/dev/null || echo "unknown")"
if [[ "${BILLING_ENABLED}" == "False" ]]; then
  die "Billing is not enabled on ${PROJECT_ID}. Link a billing account before continuing."
elif [[ "${BILLING_ENABLED}" == "unknown" ]]; then
  warn "Could not read billing status (missing permission?). Continuing, but a deploy will fail if billing is off."
else
  log "billing enabled"
fi

if [[ "${ASSUME_YES}" != "true" ]]; then
  printf '\nThis will enable APIs and create resources in the project above.\n'
  read -r -p 'Type the project ID to continue: ' CONFIRM
  [[ "${CONFIRM}" == "${PROJECT_ID}" ]] || die "Confirmation did not match. Nothing was changed."
fi

# ---------------------------------------------------------------------------
# 3. Domain Restricted Sharing -- HUMAN STEP, VERIFIED NOT AUTOMATED
# ---------------------------------------------------------------------------
step "3/6  Domain Restricted Sharing org-policy exception"

cat <<'EOF'

  ****************************************************************
  **  STOP. THIS STEP IS DONE BY A HUMAN, NOT BY THIS SCRIPT.   **
  ****************************************************************

  constraints/iam.allowedPolicyMemberDomains (Domain Restricted Sharing) is
  enforced org-wide by default in Argolis. It blocks binding "allUsers",
  which is exactly what the Firebase Hosting -> Cloud Run rewrite needs.

  Without a project-scoped exception, "terraform apply" WILL FAIL with:

    "One or more users named in the policy do not belong to a permitted
     customer"

  This script does not change org policy, by design. Editing an org-level
  constraint from a project bootstrap script is a privilege escalation that
  should require a person to type it deliberately -- and the deploy runbook
  (step 2) assigns it to a human with org-admin rights.

EOF

log "Checking current policy on ${PROJECT_ID} ..."

DRS_POLICY=""
DRS_READABLE="true"
if ! DRS_POLICY="$(gcloud org-policies describe iam.allowedPolicyMemberDomains \
      --project="${PROJECT_ID}" --format=json 2>/dev/null)"; then
  DRS_READABLE="false"
fi

DRS_OK="false"
if [[ "${DRS_READABLE}" == "true" ]] && printf '%s' "${DRS_POLICY}" | grep -q 'allUsers'; then
  DRS_OK="true"
fi

if [[ "${DRS_OK}" == "true" ]]; then
  log "OK -- a project-scoped exception allowing allUsers is in place."
else
  if [[ "${DRS_READABLE}" == "false" ]]; then
    warn "Could not read the org policy for this project."
    warn "That usually means no project-level override exists (the org default"
    warn "applies), or your account lacks orgpolicy.policy.get."
  else
    warn "A project-level policy exists but does not allow allUsers."
  fi

  cat <<EOF

  Apply the exception, then re-run this script:

    cat > /tmp/drs-exception.yaml <<'YAML'
    name: projects/${PROJECT_ID}/policies/iam.allowedPolicyMemberDomains
    spec:
      rules:
        - allowValues:
            - "allUsers"
            - "allAuthenticatedUsers"
    YAML

    gcloud org-policies set-policy /tmp/drs-exception.yaml
    gcloud org-policies describe iam.allowedPolicyMemberDomains --project="${PROJECT_ID}"

  If that returns a permission error, your account lacks
  roles/orgpolicy.policyAdmin at the org node. Grant it to yourself first --
  see deploy runbook step 2.

  Policy changes take a minute or two to propagate. A deploy attempted
  immediately after can still fail; wait, then retry ONCE before debugging
  anything else.

EOF

  if [[ "${ASSUME_YES}" == "true" ]]; then
    die "DRS exception not verified and --yes cannot approve it. Apply the policy and re-run."
  fi

  printf 'Options: [r]echeck now, [c]ontinue anyway (backend only, no public access), [a]bort\n'
  read -r -p 'Choice [r/c/a]: ' DRS_CHOICE
  case "${DRS_CHOICE}" in
    r|R)
      if gcloud org-policies describe iam.allowedPolicyMemberDomains \
           --project="${PROJECT_ID}" --format=json 2>/dev/null | grep -q 'allUsers'; then
        log "OK -- exception now visible."
        DRS_OK="true"
      else
        die "Still not visible. Apply the policy (or wait for propagation) and re-run."
      fi
      ;;
    c|C)
      warn "Continuing WITHOUT the DRS exception."
      warn "Set allow_public_api_access = false in terraform.tfvars, or apply will fail."
      warn "The Hosting /api/** rewrite will return 403 until this is resolved."
      ;;
    *)
      die "Aborted. Nothing was changed."
      ;;
  esac
fi

log "Reminder: leave constraints/storage.publicAccessPrevention ENFORCED."
log "The logo bucket must stay private; that constraint works in our favour."

# ---------------------------------------------------------------------------
# 4. Enable bootstrap APIs
# ---------------------------------------------------------------------------
step "4/6  Enabling bootstrap APIs"

# Only what Terraform needs to get going. Terraform's apis.tf enables the
# full set -- but it cannot enable serviceusage with serviceusage disabled,
# so these three are the chicken-and-egg minimum.
BOOTSTRAP_APIS=(
  "cloudresourcemanager.googleapis.com"
  "serviceusage.googleapis.com"
  "iam.googleapis.com"
)

log "Enabling: ${BOOTSTRAP_APIS[*]}"
log "(idempotent -- already-enabled services are a no-op)"
gcloud services enable "${BOOTSTRAP_APIS[@]}" --project="${PROJECT_ID}"
log "done. Terraform's apis.tf enables the remainder on first apply."

# ---------------------------------------------------------------------------
# 5. Terraform state bucket (optional)
# ---------------------------------------------------------------------------
step "5/6  Terraform state location"

if [[ -n "${TF_STATE_BUCKET}" ]]; then
  if gcloud storage buckets describe "gs://${TF_STATE_BUCKET}" >/dev/null 2>&1; then
    log "state bucket gs://${TF_STATE_BUCKET} already exists"
  else
    log "creating state bucket gs://${TF_STATE_BUCKET}"
    gcloud storage buckets create "gs://${TF_STATE_BUCKET}" \
      --project="${PROJECT_ID}" \
      --location="${REGION}" \
      --uniform-bucket-level-access \
      --public-access-prevention
    # Versioning on state is not optional -- it is the only undo for a
    # corrupted or truncated state file.
    gcloud storage buckets update "gs://${TF_STATE_BUCKET}" --versioning
    log "created, with versioning enabled"
  fi

  cat <<EOF

  Remote state bucket is ready. To use it:
    1. Uncomment the backend "gcs" block in infra/versions.tf
    2. Set bucket = "${TF_STATE_BUCKET}"
    3. Run: terraform -chdir=infra init -migrate-state

EOF
else
  log "no --state-bucket given; using LOCAL state in infra/"
  log "Local state is fine for one operator on a one-off contest project."
  log "If a second person will ever run terraform, re-run with --state-bucket."
fi

# ---------------------------------------------------------------------------
# 6. terraform init + plan
# ---------------------------------------------------------------------------
step "6/6  Terraform init and plan"

if [[ "${SKIP_TERRAFORM}" == "true" ]]; then
  log "--skip-terraform given; stopping before init."
else
  [[ -d "${INFRA_DIR}" ]] || die "infra/ directory not found at ${INFRA_DIR}"

  if [[ ! -f "${INFRA_DIR}/terraform.tfvars" ]]; then
    warn "infra/terraform.tfvars does not exist."
    warn "Copy the example and fill it in:"
    warn "  cp ${INFRA_DIR}/terraform.tfvars.example ${INFRA_DIR}/terraform.tfvars"
    warn "Skipping plan (it would prompt for every required variable)."
    SKIP_TERRAFORM="plan-only-skip"
  fi

  log "terraform init"
  terraform -chdir="${INFRA_DIR}" init -input=false

  log "terraform fmt -check"
  terraform -chdir="${INFRA_DIR}" fmt -check -recursive || \
    warn "formatting drift detected; run 'terraform -chdir=infra fmt -recursive'"

  log "terraform validate"
  terraform -chdir="${INFRA_DIR}" validate

  if [[ "${SKIP_TERRAFORM}" != "plan-only-skip" ]]; then
    log "terraform plan"
    terraform -chdir="${INFRA_DIR}" plan -input=false \
      -var="project_id=${PROJECT_ID}" \
      -var="region=${REGION}"
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
printf '\n'
rule
printf '[bootstrap] SUMMARY\n'
rule
printf '  Project              : %s (%s)\n' "${PROJECT_ID}" "${PROJECT_NUMBER}"
printf '  Region               : %s\n' "${REGION}"
printf '  Account              : %s\n' "${ACTIVE_ACCOUNT}"
printf '  DRS exception        : %s\n' "$([[ "${DRS_OK}" == "true" ]] && echo "verified" || echo "NOT VERIFIED -- public API access will fail")"
printf '  Bootstrap APIs       : enabled\n'
printf '  Terraform state      : %s\n' "${TF_STATE_BUCKET:-local (infra/terraform.tfstate)}"
printf '  Terraform init/plan  : %s\n' "$([[ "${SKIP_TERRAFORM}" == "false" ]] && echo "completed" || echo "skipped")"
rule
cat <<'NEXT'
  Nothing has been APPLIED. This script never applies.

  Next:
    1. Review the plan above.
    2. Add Firebase to the project and configure Auth -- email-link sign-in
       ONLY, no other provider, authorized domain added, template customised,
       and send yourself a test link. (Deploy runbook step 5. Do this before
       inviting anyone; it is the riskiest assumption in the deployment.)
    3. Run: scripts/deploy.sh --project-id PROJECT_ID

NEXT
