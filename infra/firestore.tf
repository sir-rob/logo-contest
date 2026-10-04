# ---------------------------------------------------------------------------
# Firestore (Native mode) + composite indexes.
#
# INDEX AUTHORITY: the repo-root `firestore.indexes.json` is the single
# source of truth. This file READS that JSON and generates one
# google_firestore_index per entry, so the two cannot drift -- there is only
# one list. Add an index by editing the JSON, then `terraform apply`.
#
# Corollary: do NOT run `firebase deploy --only firestore:indexes`. It would
# create the same indexes out-of-band, Terraform would then see resources it
# did not create, and you would get to spend an evening importing them.
# scripts/deploy.sh deliberately deploys rules only.
# ---------------------------------------------------------------------------

resource "google_firestore_database" "default" {
  project = var.project_id
  name    = "(default)"

  # Native mode, not Datastore mode. The app uses transactions for the
  # one-submission-per-user invariant and for ballot writes.
  type        = "FIRESTORE_NATIVE"
  location_id = var.firestore_location_id

  # Point-in-time recovery is a paid feature and overkill here: the runbook's
  # rollback plan is a `gcloud firestore export` taken before any risky
  # change, which at this data size costs effectively nothing.
  concurrency_mode = "OPTIMISTIC"

  # Guard rail. A contest with real submissions in it should not be
  # destroyable by a stray `terraform destroy`; flip this to ABANDON
  # consciously if you genuinely mean to tear the contest down.
  delete_protection_state = "DELETE_PROTECTION_ENABLED"

  depends_on = [google_project_service.required]
}

locals {
  firestore_index_file = "${path.module}/../firestore.indexes.json"

  # Key on collection group + ordered field spec so the map key is stable as
  # long as the index itself is unchanged. Reordering entries in the JSON
  # therefore does NOT churn state; changing an index's fields correctly
  # forces a replacement (Firestore indexes are immutable anyway).
  firestore_indexes = {
    for idx in jsondecode(file(local.firestore_index_file)).indexes :
    format(
      "%s:%s",
      idx.collectionGroup,
      join(",", [
        for f in idx.fields :
        format("%s=%s", f.fieldPath, try(f.order, try(f.arrayConfig, "UNSPECIFIED")))
      ])
    ) => idx
  }
}

resource "google_firestore_index" "composite" {
  for_each = local.firestore_indexes

  project     = var.project_id
  database    = google_firestore_database.default.name
  collection  = each.value.collectionGroup
  query_scope = try(each.value.queryScope, "COLLECTION")

  dynamic "fields" {
    for_each = each.value.fields
    content {
      field_path = fields.value.fieldPath

      # Exactly one of order / array_config may be set per field. The JSON
      # currently uses `order` throughout; `arrayConfig` is handled so that
      # adding an array-contains index later needs no change here.
      order        = try(fields.value.order, null)
      array_config = try(fields.value.arrayConfig, null)
    }
  }

  depends_on = [google_firestore_database.default]
}

# NOTE on security rules: firestore.rules is deployed by the Firebase CLI
# (see scripts/deploy.sh), not Terraform. The rules deny everything
# unconditionally -- clients never touch Firestore directly, only the API's
# service account does, and service accounts bypass rules. Managing a
# four-line always-deny ruleset through Terraform's ruleset/release resource
# pair would be more moving parts than the thing it manages.
