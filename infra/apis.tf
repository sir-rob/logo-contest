# ---------------------------------------------------------------------------
# Service (API) enablement.
#
# Every other resource in this configuration depends on one of these being
# on. Terraform is not great at inferring that -- it will happily try to
# create a Cloud Run service ninety seconds before the Run API finishes
# enabling -- so downstream resources carry explicit depends_on.
# ---------------------------------------------------------------------------

locals {
  # Matches the list in 03-DEPLOY-RUNBOOK.md step 3, minus secretmanager:
  # this app has no secrets to store (see infra/README.md), and enabling an
  # API "just in case" is how a project accumulates attack surface nobody
  # remembers agreeing to.
  required_services = [
    "cloudresourcemanager.googleapis.com", # project/IAM reads; several other APIs depend on it
    "serviceusage.googleapis.com",         # lets Terraform enable the rest
    "iam.googleapis.com",                  # dedicated runtime service account
    "iamcredentials.googleapis.com",       # signBlob -- how the API mints V4 signed URLs without a key file
    "run.googleapis.com",                  # the API service
    "artifactregistry.googleapis.com",     # the API container image
    "cloudbuild.googleapis.com",           # `gcloud run deploy --source` / any future CI build path
    "firestore.googleapis.com",            # data
    "storage.googleapis.com",              # logo bucket
    "firebasestorage.googleapis.com",      # registers the bucket with Firebase so storage.rules applies
    "firebase.googleapis.com",             # Firebase project association
    "firebasehosting.googleapis.com",      # static bundle + /api/** rewrite
    "identitytoolkit.googleapis.com",      # Firebase Auth (magic link)
    "logging.googleapis.com",
    "monitoring.googleapis.com",
  ]
}

resource "google_project_service" "required" {
  for_each = toset(local.required_services)

  project = var.project_id
  service = each.value

  # WHY disable_on_destroy = false:
  # `terraform destroy` on this config should remove the contest, not
  # lobotomise the project. Disabling an API is project-wide and affects
  # anything else that happens to be running there -- and re-enabling is
  # slow and occasionally flaky. If the project itself is being deleted,
  # the APIs go with it anyway, so there is no cleanup value here at all.
  disable_on_destroy = false

  # Same reasoning for dependent services: never let a destroy cascade into
  # turning off APIs we did not explicitly manage.
  disable_dependent_services = false
}
