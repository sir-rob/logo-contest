# ---------------------------------------------------------------------------
# Terraform and provider version pinning.
#
# Pinned deliberately. This project gets deployed once, sits idle for months,
# and then has to come back to life next year when somebody re-runs the
# contest. Unpinned providers are how that second run turns into an
# afternoon of debugging schema changes nobody asked for.
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.6.0, < 2.0.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.14"
    }

    # google-beta is declared because Firebase-adjacent resources
    # (google_firebase_project, google_firebase_hosting_*) only exist there.
    # We currently manage Hosting through the Firebase CLI instead of
    # Terraform -- see hosting.tf and infra/README.md for that decision --
    # but the provider stays declared so enabling it later is a one-line
    # change rather than a state-shuffling exercise.
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.14"
    }
  }

  # -------------------------------------------------------------------------
  # State backend.
  #
  # Local state is intentional and, for this project, correct: one operator,
  # one throwaway Argolis project, a state file that is trivially
  # reconstructible from `terraform import` if it is ever lost.
  #
  # The moment a SECOND person needs to run `terraform apply` -- or the
  # moment you want state to survive a laptop reimage -- switch to the GCS
  # backend below. Create the bucket first (scripts/bootstrap.sh does this
  # when TF_STATE_BUCKET is set), then uncomment and run
  # `terraform init -migrate-state`.
  #
  # backend "gcs" {
  #   bucket = "n7-logo-contest-tfstate"
  #   prefix = "infra"
  # }
  # -------------------------------------------------------------------------
}
