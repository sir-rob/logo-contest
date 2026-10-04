# ---------------------------------------------------------------------------
# Live configuration for the Media Moguls (North 7) Logo Design Contest.
# Gitignored along with the rest of the local Terraform state.
#
# Created 2026-09-13, after the project was bootstrapped:
#   project  n7-logo-contest  (org saurabhma.altostrat.com / 468297853503)
#   billing  Argolis Billing (saurabhma) -- linked
#   DRS      project-scoped exception applied and verified (allowAll: true)
# ---------------------------------------------------------------------------

# --- Required ---------------------------------------------------------------

project_id = "n7-logo-contest"

# The account promoted to admin on FIRST SIGN-IN, then never consulted again.
#
# Note this is deliberately the CORP account, not the Argolis one used to build
# the infrastructure. Two different identities doing two different jobs:
# admin@saurabhma.altostrat.com owns the cloud project, saurabhma@google.com is
# a participant in the contest. The bootstrap address must be on a domain in
# allowed_domains below, or it could never sign in to be promoted.
bootstrap_admin_email = "saurabhma@google.com"

app_url = "https://n7-logo-contest.web.app"

# Placeholder. scripts/deploy.sh overrides this with the real image and git
# short SHA on every deploy. On a brand-new project Artifact Registry does not
# exist yet, so this cannot point at anything real until the first apply --
# deploy.sh sequences that correctly.
api_image = "us-east4-docker.pkg.dev/n7-logo-contest/contest/contest-api:bootstrap"

# --- Regional ---------------------------------------------------------------

# NYC-based team, so east coast for everything that serves requests.
region = "us-east4"

# Left at the US multi-region even though compute is us-east4. nam5 spans US
# regions including the east coast, so the latency cost is negligible, and the
# value is IMMUTABLE once the database exists -- durability is the right
# tie-breaker for a one-shot decision.
firestore_location_id = "nam5"

# --- Application ------------------------------------------------------------

service_name = "contest-api"

# Restored to true 2026-09-13 once the service came up healthy.
#
# History, so the next person understands why this variable exists at all: the
# first Cloud Run create failed because the container image had not been built
# yet. Terraform taints a resource whose creation failed, a tainted resource is
# REPLACED rather than updated, and replacement is a destroy-then-create that
# deletion protection refuses — so the bootstrap deadlocked on a service that
# had never worked. Flipping this false broke the deadlock; the service was
# ultimately recovered by removing it from state and recreating it cleanly.
#
# Safe to flip false again if that ever recurs: Cloud Run is stateless, so
# replacing the service loses nothing. The contest's actual data lives in
# Firestore and the logo bucket, which are untouched by it.
cloud_run_deletion_protection = true

# The membership test: possession of a mailbox on this domain IS the
# eligibility rule. Comma-separated, so a second domain is a config change and
# a redeploy, never a code change -- which is the fallback if corp mail
# filtering blocks the magic links.
allowed_domains = "google.com"

# Empty defaults to app_url.
cors_origins = ""

default_contest_id = "media-moguls-2026"
log_level          = "info"

# Empty defaults to "n7-logo-contest-logos".
bucket_name = ""

artifact_repository_id = "contest"

# ~25 participants. Three instances is generous headroom; Cloud Run still
# scales to zero when idle, which is why steady-state cost is ~nothing.
max_instances = 3

noncurrent_version_retention_days = 30

# Requires the DRS exception, which IS applied and verified on this project.
# This is the single public IAM binding in the whole stack: allUsers gets
# roles/run.invoker so Firebase Hosting can proxy /api/**. The logo bucket
# stays private behind signed URLs, with publicAccessPrevention still enforced.
allow_public_api_access = true
