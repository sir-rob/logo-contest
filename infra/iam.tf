# ---------------------------------------------------------------------------
# Identity and access for the API.
#
# The runbook puts it well: "The API's service account gets Firestore and
# Storage access. Nothing else does -- that's what makes the anonymity
# guarantee hold at the infrastructure layer rather than just in code."
#
# So every grant below is justified individually, and the list is short by
# design. If you find yourself adding a role to make an error go away, work
# out which specific permission is missing first.
# ---------------------------------------------------------------------------

resource "google_service_account" "api" {
  project      = var.project_id
  account_id   = "${var.service_name}-sa"
  display_name = "N7 Logo Contest API runtime"
  description  = "Dedicated runtime identity for the Cloud Run API. Never reuse for anything else."

  depends_on = [google_project_service.required]
}

# --- Firestore ---------------------------------------------------------------
# roles/datastore.user: read and write documents. NOT datastore.owner, which
# also allows creating/deleting indexes and databases -- Terraform does that,
# the running app has no business doing it.
resource "google_project_iam_member" "api_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.api.email}"
}

# --- Storage: bucket-scoped, not project-scoped ------------------------------
# roles/storage.objectAdmin on THIS ONE BUCKET. The API creates, reads,
# overwrites and deletes submission objects, which objectViewer/objectCreator
# alone cannot cover.
#
# Scoped to the bucket resource deliberately. A project-level storage.admin
# (or even project-level objectAdmin) would also hand the API the Terraform
# state bucket, any Firestore export bucket, and every bucket created in this
# project in future -- for zero benefit. If this service account is ever
# compromised, the blast radius should be "the logo images", which the
# attacker could mostly see through the app anyway.
resource "google_storage_bucket_iam_member" "api_objects" {
  bucket = google_storage_bucket.logos.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}

# --- Firebase Auth -----------------------------------------------------------
# roles/firebaseauth.admin: verify ID tokens, look users up by email, and set
# the `admin` custom claim. Claim-setting is the part that forces `admin`
# rather than `viewer` -- the bootstrap-admin promotion and the admin console
# both write custom claims.
resource "google_project_iam_member" "api_firebase_auth" {
  project = var.project_id
  role    = "roles/firebaseauth.admin"
  member  = "serviceAccount:${google_service_account.api.email}"
}

# --- Self-impersonation: the reason there are no secrets to manage -----------
# roles/iam.serviceAccountTokenCreator granted ON THE SERVICE ACCOUNT ITSELF
# (note the resource: this is a binding on the SA, not on the project).
#
# V4 signed URLs require an RSA signature. The classic way to get one is to
# download a JSON key file and ship it with the app -- which means a
# long-lived private key in a secret store, in CI, and probably in someone's
# ~/Downloads. Instead, this grant lets the runtime SA call
# iamcredentials.signBlob as itself, so the Google Cloud client libraries
# sign URLs through the API with the ambient ADC credential and no key
# material ever exists.
#
# That is the whole reason infra/README.md can say "this app has no secrets".
# Remove this binding and signed image URLs stop working -- the gallery goes
# blank and the API logs a 403 from iamcredentials.
resource "google_service_account_iam_member" "api_token_creator_self" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.api.email}"
}

# --- Observability -----------------------------------------------------------
# Cloud Run grants log writing implicitly to the default compute SA, but not
# to a custom one. Without this, the service runs fine and logs nothing,
# which is a miserable way to debug a contest at 9pm.
resource "google_project_iam_member" "api_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.api.email}"
}

# Custom metrics and the built-in Cloud Run request metrics.
resource "google_project_iam_member" "api_metric_writer" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.api.email}"
}

# ---------------------------------------------------------------------------
# NOT GRANTED, on purpose -- listed so the omissions read as decisions:
#   roles/editor              : the default-SA sledgehammer. No.
#   roles/storage.admin       : would allow deleting the bucket and changing
#                               its public-access settings. The app has no
#                               reason to do either.
#   roles/datastore.owner     : index/database management belongs to Terraform.
#   roles/secretmanager.*     : there are no secrets (see infra/README.md).
#   roles/firebase.admin      : far broader than token verification needs.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Public invoker for the Cloud Run service.
#
# Firebase Hosting's `/api/**` rewrite reaches Cloud Run as an UNAUTHENTICATED
# caller, so the service must allow allUsers to invoke it. Application-level
# auth is unaffected: every route still verifies a Firebase ID token and
# re-checks the domain allowlist on every request. "Public" here means
# "reachable", not "unprotected".
#
# THIS IS THE BINDING THAT DOMAIN RESTRICTED SHARING BLOCKS.
# constraints/iam.allowedPolicyMemberDomains must have a project-scoped
# exception allowing allUsers BEFORE this applies -- a human does that by
# hand, per 03-DEPLOY-RUNBOOK.md step 2. Terraform deliberately does not
# touch org policy: changing an org-level constraint from a project-level
# config is the kind of privilege escalation that should require somebody to
# type it themselves.
#
# If apply fails here with "One or more users named in the policy do not
# belong to a permitted customer", the exception is missing or has not
# propagated yet. Wait a couple of minutes and retry once before debugging.
# ---------------------------------------------------------------------------
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count = var.allow_public_api_access ? 1 : 0

  project  = var.project_id
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
