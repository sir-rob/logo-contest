# ---------------------------------------------------------------------------
# Input variables.
#
# Anything that would differ between "this contest" and "the same contest run
# again next year in a fresh project" lives here. Nothing else does.
# ---------------------------------------------------------------------------

variable "project_id" {
  type        = string
  description = <<-EOT
    The Google Cloud (Argolis) project ID that hosts the entire contest app.
    Everything lives in one project on purpose: the blast radius of a
    `terraform destroy` is exactly this contest and nothing else.
  EOT

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id must be a valid GCP project ID (6-30 chars, lowercase letters, digits and hyphens, starting with a letter)."
  }
}

variable "region" {
  type        = string
  description = <<-EOT
    Region for Cloud Run, Artifact Registry and the logo bucket. Keep all
    three in the same region -- the API reads and writes images on nearly
    every request, and cross-region egress is both slower and billable.
  EOT
  default     = "us-east4"
}

variable "cloud_run_deletion_protection" {
  type        = bool
  description = <<-EOT
    Guards the Cloud Run service against accidental deletion by Terraform.

    Keep this TRUE in normal operation. Set it false ONLY to recover from a
    failed initial create: Terraform taints a resource whose creation failed,
    a tainted resource is REPLACED rather than updated, and replacement is a
    destroy-then-create that deletion protection refuses -- which deadlocks
    the bootstrap on a service that never worked.

    Safe to toggle: Cloud Run is stateless. The contest's data lives in
    Firestore and Cloud Storage, neither of which is affected.
  EOT
  default     = true
}

variable "firestore_location_id" {
  type        = string
  description = <<-EOT
    Firestore location. This is a MULTI-REGION name (`nam5`, `eur3`) or a
    regional name, and it is IMMUTABLE once the database exists -- changing
    it later means a new database, not a moved one.

    Left at `nam5` (US multi-region) deliberately even though Cloud Run runs
    in us-east4. nam5 spans US regions including the east coast, so the
    latency cost for an NYC team is negligible, and multi-region buys
    durability that a single region does not. Given the value is immutable,
    the resilient choice is the right default.
  EOT
  default     = "nam5"
}

variable "service_name" {
  type        = string
  description = <<-EOT
    Cloud Run service name for the API. This MUST match the `serviceId` in
    the root `firebase.json` hosting rewrite (`/api/**` -> this service), or
    the site will serve the SPA shell for API calls and every request will
    mysteriously return index.html.
  EOT
  default     = "contest-api"
}

variable "api_image" {
  type        = string
  description = <<-EOT
    Fully-qualified container image for the API, including an IMMUTABLE tag:
      REGION-docker.pkg.dev/PROJECT/REPO/contest-api:GIT_SHA

    Never point this at `:latest`. scripts/deploy.sh passes the git short SHA
    so that a rollback is "apply the previous value of this variable" rather
    than "hope the registry still has what you think it has".
  EOT

  validation {
    condition     = can(regex("^[a-z0-9-]+-docker\\.pkg\\.dev/[^:]+:[^:]+$", var.api_image)) && !endswith(var.api_image, ":latest")
    error_message = "api_image must be a full Artifact Registry path with an explicit, non-'latest' tag."
  }
}

variable "allowed_domains" {
  type        = string
  description = <<-EOT
    Comma-separated list of email domains permitted to sign in. Passed
    verbatim to the API as ALLOWED_DOMAINS; the API parses and lowercases it.

    This is the entire membership test for the contest. Widening it is a
    config change and a redeploy, which is the point -- but it is also the
    single most consequential value in this file, so change it deliberately.
  EOT
  default     = "google.com"

  validation {
    condition     = length(trimspace(var.allowed_domains)) > 0
    error_message = "allowed_domains must not be empty; an empty allowlist would lock everyone out."
  }
}

variable "bootstrap_admin_email" {
  type        = string
  description = <<-EOT
    The one account promoted to admin on its first sign-in, after which the
    value stops being consulted. Not a secret (it is an email address on the
    allowed domain), but it IS privileged, so it is a variable rather than a
    hardcoded string -- see infra/README.md on why this does not warrant
    Secret Manager.
  EOT

  validation {
    condition     = can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", var.bootstrap_admin_email))
    error_message = "bootstrap_admin_email must look like a single valid email address."
  }
}

variable "app_url" {
  type        = string
  description = <<-EOT
    Public origin of the web app, e.g. https://n7-logo-contest.web.app.
    Used by the API to build magic-link continue URLs, so a wrong value here
    produces sign-in links that land somewhere useless.
  EOT

  validation {
    condition     = can(regex("^https://", var.app_url)) && !endswith(var.app_url, "/")
    error_message = "app_url must be an https:// URL with no trailing slash."
  }
}

variable "cors_origins" {
  type        = string
  description = <<-EOT
    Comma-separated allowed browser origins for the API. Leave empty to
    default to app_url alone, which is the correct answer in production:
    the SPA is same-origin with the API thanks to the Hosting `/api/**`
    rewrite, so this mostly matters for the direct *.run.app URL.
  EOT
  default     = ""
}

variable "default_contest_id" {
  type        = string
  description = <<-EOT
    Firestore document ID of the contest the app serves when no contest is
    named explicitly. One contest per project, so this is effectively a
    constant -- but it is seeded data, not infrastructure, so it stays
    configurable.
  EOT
  default     = "north7-2026"
}

variable "log_level" {
  type        = string
  description = "Pino log level for the API. `info` in production; `debug` only while actively debugging, since request logs can carry email addresses."
  default     = "info"

  validation {
    condition     = contains(["fatal", "error", "warn", "info", "debug", "trace", "silent"], var.log_level)
    error_message = "log_level must be one of: fatal, error, warn, info, debug, trace, silent."
  }
}

variable "bucket_name" {
  type        = string
  description = <<-EOT
    Name of the private bucket holding submission images. Leave empty to get
    `PROJECT_ID-logos`, which is what .env.example already assumes. Bucket
    names are globally unique, so override only if that name is taken.
  EOT
  default     = ""
}

variable "artifact_repository_id" {
  type        = string
  description = "Artifact Registry Docker repository ID for the API image."
  default     = "contest"
}

variable "max_instances" {
  type        = number
  description = <<-EOT
    Cloud Run max instance count. Kept deliberately tiny: the electorate is
    ~25 people, and a low ceiling is the cheapest possible protection against
    a runaway loop quietly billing an Argolis project all weekend.
  EOT
  default     = 3

  validation {
    condition     = var.max_instances >= 1 && var.max_instances <= 10
    error_message = "max_instances must be between 1 and 10; this app has no business scaling beyond that."
  }
}

variable "noncurrent_version_retention_days" {
  type        = number
  description = <<-EOT
    How long superseded object versions are kept before deletion. CURRENT
    objects are never expired -- the winning logo is the artifact this whole
    exercise exists to produce, and no lifecycle rule should ever be able to
    eat it.
  EOT
  default     = 30
}

variable "allow_public_api_access" {
  type        = bool
  description = <<-EOT
    Grants `allUsers` the run.invoker role so Firebase Hosting can proxy
    /api/** to Cloud Run. REQUIRES the Domain Restricted Sharing org-policy
    exception from the deploy runbook (step 2) to already be in place -- a
    human does that, not Terraform. If the exception is missing, apply fails
    with a policy error; that failure is the intended signal, not a bug.

    Set to false only if you are deliberately deploying the backend before
    the exception has been cleared.
  EOT
  default     = true
}
