# ---------------------------------------------------------------------------
# Firebase Hosting -- DELIBERATELY NOT MANAGED BY TERRAFORM.
#
# This file is an intentional stub. Nothing here creates a resource. It
# exists so that the next person who opens infra/ and wonders "where's
# Hosting?" finds the answer next to the other .tf files rather than only in
# a README.
#
# ---------------------------------------------------------------------------
# THE DECISION
# ---------------------------------------------------------------------------
# Hosting is managed by `firebase.json` at the repo root plus
# `firebase deploy --only hosting` in scripts/deploy.sh.
#
# Why not Terraform:
#
# 1. The rewrite config would be duplicated. `firebase.json` ALREADY defines
#    the /api/** -> Cloud Run rewrite, the SPA catch-all, and the security
#    headers, and the Firebase CLI and the emulator both read it. Terraform
#    cannot read firebase.json; it would need its own copy of the same
#    config in a google_firebase_hosting_version resource. Two copies of
#    routing rules that must agree is precisely the drift this repo tries to
#    avoid elsewhere (compare firestore.tf, which reads the JSON rather than
#    restating it).
#
# 2. Terraform does not upload the bundle. google_firebase_hosting_version /
#    _release can describe a version, but the actual static files still get
#    pushed by the CLI. A "Terraformed" Hosting setup here would be a
#    half-managed resource -- Terraform owning the config, the CLI owning the
#    content -- which is worse than either option done wholly.
#
# 3. Those resources are google-beta only and have historically churned.
#    Pinning a beta provider to manage something the CLI does well is a
#    maintenance cost with no matching benefit.
#
# 4. `firebase.json` is owned by another part of this codebase. Terraform
#    reaching in to restate its contents would create a cross-ownership
#    conflict for no gain.
#
# WHAT THIS MEANS OPERATIONALLY
#   * `terraform apply` does NOT deploy the web app. It provisions the
#     backend the web app talks to.
#   * `scripts/deploy.sh` runs both, in the right order: image -> terraform
#     -> web bundle -> firebase deploy.
#   * The Firebase project association and the default web.app site are
#     created when Firebase is added to the project (runbook step 5,
#     console work). Terraform enables firebase.googleapis.com and
#     firebasehosting.googleapis.com in apis.tf so that step is unblocked.
#
# THE ONE COUPLING TO WATCH
#   var.service_name here MUST equal the `serviceId` in firebase.json's
#   rewrite (currently "contest-api"), and var.region must equal its
#   "region" (currently "us-central1"). There is no way to enforce that
#   across the two tools, so it is asserted in infra/README.md and checked
#   by scripts/deploy.sh before it deploys Hosting.
#
# IF YOU CHANGE YOUR MIND
#   Adding Hosting to Terraform later means: enable the google-beta provider
#   usage, add google_firebase_hosting_site / _version / _release, move the
#   rewrite config out of firebase.json (or accept the duplication), and
#   update deploy.sh to stop calling `firebase deploy --only hosting`.
#   Do all of it or none of it.
# ---------------------------------------------------------------------------
