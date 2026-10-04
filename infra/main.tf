# ---------------------------------------------------------------------------
# Provider configuration and shared locals.
#
# There is exactly one project, one region, and one environment. Resisting
# the urge to build a module hierarchy for that is a feature.
# ---------------------------------------------------------------------------

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

locals {
  # Bucket names are globally unique, so derive from the project ID -- which
  # already is. Matches STORAGE_BUCKET in .env.example.
  bucket_name = var.bucket_name != "" ? var.bucket_name : "${var.project_id}-logos"

  # CORS_ORIGINS defaults to just the app itself. In production the SPA and
  # the API are same-origin (Hosting rewrites /api/** to Cloud Run), so this
  # only comes into play for the direct *.run.app URL and for local dev.
  cors_origins = var.cors_origins != "" ? var.cors_origins : var.app_url

  # Every resource gets these, so a stray object in the project is traceable
  # back to this contest rather than being a mystery six months from now.
  common_labels = {
    app        = "n7-logo-contest"
    component  = "logo-contest"
    managed-by = "terraform"
  }
}
