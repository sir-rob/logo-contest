# ---------------------------------------------------------------------------
# Outputs.
#
# These are the four values you actually need after an apply: where the API
# is, where the images are, who the API is, and where to push images.
# scripts/deploy.sh reads several of them.
# ---------------------------------------------------------------------------

output "api_service_url" {
  description = "Direct HTTPS URL of the Cloud Run API. Useful for curl and smoke tests; end users reach the API through the Hosting /api/** rewrite instead."
  value       = google_cloud_run_v2_service.api.uri
}

output "api_service_name" {
  description = "Cloud Run service name. Must match the serviceId in firebase.json's hosting rewrite."
  value       = google_cloud_run_v2_service.api.name
}

output "storage_bucket_name" {
  description = "Name of the private submission-image bucket. This is the value the API receives as STORAGE_BUCKET."
  value       = google_storage_bucket.logos.name
}

output "storage_bucket_url" {
  description = "gs:// URI of the image bucket, for gcloud storage commands during the runbook smoke test."
  value       = "gs://${google_storage_bucket.logos.name}"
}

output "api_service_account_email" {
  description = "Dedicated runtime service account for the API. The only identity with access to contest data."
  value       = google_service_account.api.email
}

output "artifact_registry_repository" {
  description = "Artifact Registry repository path. Image tags are REPO/SERVICE_NAME:GIT_SHA; deploy.sh builds that reference from this output."
  value       = "${google_artifact_registry_repository.docker.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"
}

output "deployed_image" {
  description = "The exact image reference this state is running. Record it before a risky deploy -- rolling back is re-applying with api_image set to this."
  value       = var.api_image
}

output "firestore_database" {
  description = "Firestore database ID, location and mode, for confirming Native mode came up in the expected place."
  value = {
    name     = google_firestore_database.default.name
    location = google_firestore_database.default.location_id
    type     = google_firestore_database.default.type
  }
}

output "public_api_access_enabled" {
  description = "Whether allUsers holds run.invoker. False means the Hosting /api/** rewrite will 403 -- check the DRS org-policy exception (runbook step 2)."
  value       = var.allow_public_api_access
}
