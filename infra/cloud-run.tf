# ---------------------------------------------------------------------------
# Cloud Run -- the API service.
#
# Sizing note: the electorate is ~25 people who will mostly all show up in
# the same ten minutes twice (submission deadline, voting deadline). That is
# a tiny burst, not sustained load. Everything below is tuned for "costs
# nothing at rest, survives a small thundering herd".
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_service" "api" {
  project  = var.project_id
  name     = var.service_name
  location = var.region

  # Ingress is open because Firebase Hosting proxies to this service from
  # Google's edge, not from inside the VPC. INTERNAL_AND_CLOUD_LOAD_BALANCING
  # would break the Hosting rewrite.
  ingress = "INGRESS_TRAFFIC_ALL"

  # Terraform should not be able to delete a live contest backend by accident.
  #
  # A variable rather than a hardcoded `true` because of a real situation hit
  # during first deploy: if the service's initial creation FAILS (ours did —
  # the image had not been built yet), Terraform marks the resource tainted,
  # and a tainted resource is REPLACED rather than updated. Replacement means
  # destroy-then-create, which deletion protection blocks — so the bootstrap
  # deadlocks on a service that never worked in the first place.
  #
  # Keep it true in normal operation. Flip it false in terraform.tfvars only to
  # recover from a broken create, then flip it straight back. Cloud Run is
  # stateless, so replacing the service loses nothing; the contest's actual
  # data lives in Firestore and Cloud Storage.
  deletion_protection = var.cloud_run_deletion_protection

  labels = local.common_labels

  template {
    # DEDICATED runtime identity -- never the default compute service account,
    # which carries roles/editor on most projects. See iam.tf.
    service_account = google_service_account.api.email

    # Scale to zero. Between contests this service should cost literally
    # nothing; a cold start of a ~200MB Node image is a second or two, which
    # is entirely acceptable for an internal tool.
    # The ceiling is small on purpose -- see var.max_instances.
    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    # Fastify is async and this workload is I/O-bound (Firestore, GCS), so
    # one instance handles plenty of simultaneous requests. 40 keeps us to a
    # single warm instance under realistic contest load while leaving
    # headroom before a second one spins up.
    max_instance_request_concurrency = 40

    # Image uploads run through sharp (EXIF strip + resize), which decodes
    # the whole bitmap in memory. 512Mi is uncomfortably tight for a large
    # PNG; 1Gi is cheap insurance against an OOM kill mid-upload.
    # Uploads are also the slowest request type, hence the generous timeout.
    timeout = "120s"

    containers {
      image = var.api_image

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        # CPU is only allocated during request processing. Correct here: there
        # is no background work between requests, and it is what makes
        # scale-to-zero actually free.
        cpu_idle          = true
        startup_cpu_boost = true
      }

      # Cloud Run injects PORT into the container and REJECTS an explicit
      # PORT entry in the env list ("reserved env names were provided").
      # Declaring the container port here is how you set it: Cloud Run then
      # exports PORT=8080, and the app reads process.env.PORT. That is why
      # PORT is absent from the env blocks below despite being in the app's
      # config schema -- it is supplied, just not by us.
      ports {
        name           = "http1"
        container_port = 8080
      }

      # --- Environment: exactly what apps/api/src/config.ts reads ----------
      env {
        name  = "NODE_ENV"
        value = "production"
      }

      # Bind to all interfaces. The Node default of 127.0.0.1 is invisible to
      # the Cloud Run frontend and produces a container-failed-to-start loop.
      env {
        name  = "HOST"
        value = "0.0.0.0"
      }

      env {
        name  = "LOG_LEVEL"
        value = var.log_level
      }

      # Both names are read by the Firebase Admin SDK / app config depending
      # on the code path, so both are set to the same value rather than
      # relying on whichever happens to win.
      env {
        name  = "GCLOUD_PROJECT"
        value = var.project_id
      }

      env {
        name  = "FIREBASE_PROJECT_ID"
        value = var.project_id
      }

      env {
        name  = "STORAGE_BUCKET"
        value = google_storage_bucket.logos.name
      }

      # The membership gate. Comma-separated; the API lowercases and trims.
      env {
        name  = "ALLOWED_DOMAINS"
        value = var.allowed_domains
      }

      # Privileged but not secret -- an email address on the allowed domain.
      # Consulted once, on that account's first sign-in, then ignored.
      env {
        name  = "BOOTSTRAP_ADMIN_EMAIL"
        value = var.bootstrap_admin_email
      }

      env {
        name  = "APP_URL"
        value = var.app_url
      }

      env {
        name  = "CORS_ORIGINS"
        value = local.cors_origins
      }

      env {
        name  = "DEFAULT_CONTEST_ID"
        value = var.default_contest_id
      }
      # --- end environment --------------------------------------------------
      #
      # Nothing else is set here. No emulator hosts (config.ts refuses to
      # start if those are present with NODE_ENV=production, which is exactly
      # the behaviour we want), and no credentials file -- the container uses
      # Application Default Credentials from the attached service account.

      # Startup probe on /healthz: "the process is up and listening". Cloud
      # Run will not send traffic or mark the revision ready until this
      # passes. Generous failure budget because a cold Node start plus
      # Firebase Admin init can take a few seconds.
      startup_probe {
        http_get {
          path = "/healthz"
          port = 8080
        }
        initial_delay_seconds = 3
        period_seconds        = 5
        timeout_seconds       = 3
        failure_threshold     = 12 # ~60s of grace before giving up
      }

      # Liveness probe on /readyz: "the process is still able to do useful
      # work" (it checks its downstream dependencies). A failure here
      # restarts the container. Deliberately slower and more forgiving than
      # the startup probe -- a transient Firestore blip should not trigger a
      # restart storm.
      liveness_probe {
        http_get {
          path = "/readyz"
          port = 8080
        }
        period_seconds    = 30
        timeout_seconds   = 5
        failure_threshold = 3
      }
    }
  }

  # All traffic to the newest revision. No canary: there are 25 users and one
  # of them is the person doing the deploy.
  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [
    google_project_service.required,
    google_service_account.api,
    google_artifact_registry_repository.docker,
    # The service must not start before it can reach its data. Without these
    # the first revision can boot, fail its readiness check against a
    # non-existent bucket, and confuse everyone.
    google_storage_bucket.logos,
    google_storage_bucket_iam_member.api_objects,
    google_firestore_database.default,
  ]

  lifecycle {
    ignore_changes = [
      # `gcloud run deploy` and the Cloud Console add their own annotations
      # on every out-of-band touch. Ignoring them stops the next plan from
      # showing phantom diffs.
      template[0].annotations["run.googleapis.com/client-name"],
      template[0].annotations["run.googleapis.com/client-version"],
      client,
      client_version,
    ]
  }
}
