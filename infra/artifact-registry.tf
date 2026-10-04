# ---------------------------------------------------------------------------
# Artifact Registry -- the API container image lives here.
# ---------------------------------------------------------------------------

resource "google_artifact_registry_repository" "docker" {
  project       = var.project_id
  location      = var.region
  repository_id = var.artifact_repository_id
  description   = "Container images for the N7 logo contest API."
  format        = "DOCKER"

  # Keep images around. Every tag is an immutable git SHA (see deploy.sh), so
  # the tag list doubles as the rollback menu -- an aggressive cleanup policy
  # would quietly delete the version you need at the worst possible moment.
  # The images are ~200MB and there will be a handful of them; storage cost
  # is a rounding error next to that risk.
  #
  # If this ever does need trimming, prefer keep-last-N over delete-older-than:
  #   cleanup_policies {
  #     id     = "keep-recent"
  #     action = "KEEP"
  #     most_recent_versions { keep_count = 10 }
  #   }

  labels = local.common_labels

  depends_on = [google_project_service.required]
}
