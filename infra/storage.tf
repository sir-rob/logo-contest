# ---------------------------------------------------------------------------
# Cloud Storage -- the one bucket that holds submission images.
#
# This bucket is the single most privacy-sensitive resource in the project.
# Read the comments before changing anything in it.
# ---------------------------------------------------------------------------

resource "google_storage_bucket" "logos" {
  project  = var.project_id
  name     = local.bucket_name
  location = upper(var.region)

  # WHY PRIVATE -- THIS IS AN ANONYMITY CONTROL, NOT JUST HYGIENE.
  #
  # The contest is judged blind. If an object URL is publicly fetchable, then
  # anyone who can guess or leak one can pull a submission outside the API --
  # and, worse, the image can be indexed, hotlinked, or correlated with an
  # uploader by timing. The entire design assumes images are reachable ONLY
  # through short-lived V4 signed URLs minted by the API after it has
  # checked who is asking.
  #
  # Concretely, that means:
  #   * NEVER add an IAM binding for `allUsers` or `allAuthenticatedUsers`
  #     on this bucket. Not for debugging, not temporarily.
  #   * NEVER set an ACL, and never turn uniform access off.
  #   * public_access_prevention stays "enforced". The runbook (step 2) is
  #     explicit that the org-level constraints/storage.publicAccessPrevention
  #     policy should stay ON -- that is one Argolis constraint we WANT
  #     working against us, and this setting means we would still be safe if
  #     somebody relaxed it.
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Versioning: an admin fat-fingering a re-upload should not be able to
  # destroy the only copy of someone's submission.
  versioning {
    enabled = true
  }

  # Lifecycle rule 1 -- prune superseded versions.
  # Deletes NONCURRENT versions only. Current objects are untouched and are
  # kept forever: the winning logo is the artifact this whole exercise exists
  # to produce, and there is no acceptable lifecycle rule that can delete it.
  lifecycle_rule {
    condition {
      with_state                 = "ARCHIVED"
      days_since_noncurrent_time = var.noncurrent_version_retention_days
    }
    action {
      type = "Delete"
    }
  }

  # Lifecycle rule 2 -- clean up incomplete multipart/resumable uploads.
  # Separate rule on purpose: this garbage-collects abandoned upload parts,
  # which are billable but invisible in the object listing. A user closing
  # the tab mid-upload should not leave a charge behind forever.
  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "AbortIncompleteMultipartUpload"
    }
  }

  # NO CORS CONFIGURATION -- deliberate.
  #
  # Signed URLs are consumed by the browser as <img src="...">. Image loads
  # are not governed by CORS unless the element opts in with crossorigin, and
  # the web app does not: it never reads pixel data, never draws to a canvas,
  # and never fetch()es the object. Uploads go to the API (multipart POST to
  # Cloud Run), not straight to GCS, so there is no browser->bucket write path
  # either.
  #
  # Adding a CORS block would therefore configure a code path nobody uses,
  # while advertising to a reader that direct browser access is expected --
  # which is exactly the wrong mental model for this bucket. If the app ever
  # moves to signed-URL direct uploads, add the block THEN, scoped to
  # var.app_url and PUT/POST only.
  #
  # cors {
  #   origin          = [var.app_url]
  #   method          = ["GET", "PUT"]
  #   response_header = ["Content-Type"]
  #   max_age_seconds = 3600
  # }

  labels = local.common_labels

  depends_on = [google_project_service.required]
}
