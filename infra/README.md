# Infrastructure — N7 Logo Contest

Terraform for everything inside the Google Cloud (Argolis) project. This is
the companion to `03-DEPLOY-RUNBOOK.md`, which covers the things Terraform
can't do for itself: creating the project, clearing org policy, and
configuring Firebase Auth.

**Read the runbook first.** This README assumes it.

---

## Prerequisites

| Tool | Why |
|---|---|
| `gcloud` | project, APIs, Artifact Registry auth |
| `terraform` ≥ 1.6 | everything in this directory |
| `firebase` CLI | Hosting and security rules |
| `node` ≥ 20 | builds the API and the web bundle |
| `docker` | builds the API image |

Plus:

- The project already exists and is linked to billing (runbook step 1).
- `gcloud auth login` **and** `gcloud auth application-default login` — Terraform
  uses ADC, which is a separate credential from the CLI's.
- The Domain Restricted Sharing exception is in place. See below.

---

## The DRS exception — a human does this, not Terraform

`constraints/iam.allowedPolicyMemberDomains` is enforced org-wide in Argolis
by default. It blocks binding `allUsers`, which is exactly what the Firebase
Hosting → Cloud Run `/api/**` rewrite needs.

**Who:** you, with `roles/orgpolicy.policyAdmin` at the org node.
**When:** before the first `terraform apply`.
**How:** runbook step 2 — a project-scoped policy allowing `allUsers` and
`allAuthenticatedUsers`.

Terraform deliberately does **not** manage org policy. Changing an
org-level constraint from a project-level config is a privilege escalation
that should require a person to type it. `scripts/bootstrap.sh` *checks*
whether the exception is in place and stops with instructions if it isn't —
it never attempts the change.

If `terraform apply` fails with *"One or more users named in the policy do
not belong to a permitted customer"*, the exception is missing or hasn't
propagated. Wait two minutes, retry **once**, then debug.

To deploy the backend before the exception is cleared, set
`allow_public_api_access = false`. The service comes up; the Hosting rewrite
returns 403 until you flip it back.

**Leave `constraints/storage.publicAccessPrevention` enforced.** The logo
bucket must stay private. That's one Argolis constraint working in our
favour — no exception needed, and the bucket sets
`public_access_prevention = "enforced"` itself so we'd be safe even if
someone relaxed the org policy.

---

## Order of operations

```bash
# 1. Once per project
scripts/bootstrap.sh --project-id n7-logo-contest

# 2. Firebase Auth — console work, runbook step 5.
#    Email-link sign-in ONLY. No other provider, especially not Anonymous.
#    Send yourself a test link and confirm it lands in the inbox, not spam.

# 3. Fill in variables
cp infra/terraform.tfvars.example infra/terraform.tfvars
$EDITOR infra/terraform.tfvars

# 4. Deploy (build → push → apply → web build → hosting)
scripts/deploy.sh --project-id n7-logo-contest --dry-run   # look first
scripts/deploy.sh --project-id n7-logo-contest
```

`bootstrap.sh` never applies. `deploy.sh` prompts before applying unless you
pass `--auto-approve`.

### Chicken-and-egg on a brand-new project

`var.api_image` points into an Artifact Registry repo that doesn't exist
until the first apply. `deploy.sh` handles the ordering. If you're applying
by hand:

```bash
terraform -chdir=infra apply -target=google_artifact_registry_repository.docker
# ...build and push...
terraform -chdir=infra apply
```

---

## What's here

| File | Contents |
|---|---|
| `versions.tf` | version pins, commented GCS backend |
| `variables.tf` | every input, typed and validated |
| `main.tf` | providers, shared locals |
| `apis.tf` | service enablement |
| `firestore.tf` | Native-mode database + composite indexes |
| `storage.tf` | the private image bucket |
| `artifact-registry.tf` | Docker repo for the API image |
| `cloud-run.tf` | the API service |
| `iam.tf` | dedicated runtime SA and every grant it has |
| `hosting.tf` | **stub** — explains why Hosting isn't Terraformed |
| `outputs.tf` | URLs, names, the deployed image reference |

---

## Deliberately NOT in Terraform

Four things, each for a reason:

**1. Firebase Hosting.** Managed by `firebase.json` + `firebase deploy
--only hosting` in `deploy.sh`. `firebase.json` already defines the
`/api/**` rewrite, the SPA catch-all and the security headers, and the CLI
and the emulator both read it. Terraform can't read that file, so a
Terraformed Hosting setup would need a second copy of the routing rules —
and it *still* couldn't upload the bundle, which the CLI does. Half-managed
is worse than either option done wholly. Full reasoning in `hosting.tf`.

> **Coupling to watch:** `var.service_name` must equal the `serviceId` in
> `firebase.json` (`contest-api`), and `var.region` must equal its `region`
> (`us-central1`). No tool enforces this across the two files; `deploy.sh`
> warns if they disagree. When they *do* disagree the symptom is
> maddening — API calls return the SPA's `index.html` with a 200.

**2. Org policy.** See above. Human, deliberately.

**3. Firebase Auth configuration.** Provider setup, authorized domains and
the email template are console work with no CLI worth scripting (runbook
step 5). The one that matters: confirm **no other provider is enabled** —
Anonymous would hand out sessions with no email at all and bypass the domain
gate completely.

**4. Security rules.** `firestore.rules` and `storage.rules` are
deny-everything files deployed by the Firebase CLI. Clients never touch
Firestore or GCS directly; only the API's service account does, and service
accounts bypass rules. Wrapping a four-line ruleset in Terraform's
ruleset/release resource pair is more moving parts than the thing it
manages.

---

## Firestore indexes: `firestore.indexes.json` is authoritative

`firestore.tf` **reads** the repo-root `firestore.indexes.json` with
`jsondecode(file(...))` and generates one `google_firestore_index` per
entry. There is one list, so the two cannot drift.

- **To add an index:** edit `firestore.indexes.json`, then `terraform apply`.
- **Do not run** `firebase deploy --only firestore:indexes`. It would create
  the same indexes out-of-band and you'd get to spend an evening running
  `terraform import`. `deploy.sh` deploys rules only, on purpose.

---

## The bucket is private, and that's a feature

One bucket, `PROJECT_ID-logos`, holding submission images.

`uniform_bucket_level_access = true`, `public_access_prevention =
"enforced"`, no `allUsers`, no `allAuthenticatedUsers`, no ACLs. Images are
served **only** through short-lived V4 signed URLs minted by the API after
it has checked who's asking.

This is an **anonymity control**, not general hygiene. The contest is judged
blind. A publicly fetchable object URL means a submission can be pulled
outside the API, indexed, hotlinked, or correlated with an uploader by
upload timing. Don't relax it — not for debugging, not temporarily.

Versioning is on. Lifecycle rules delete *noncurrent* versions after 30 days
and abort incomplete multipart uploads after 7. **Current objects are never
expired** — the winning logo is the artifact this whole exercise exists to
produce.

**No CORS block**, deliberately. Signed URLs are consumed as `<img src>`,
which isn't CORS-governed unless the element opts in, and the app never
does: it doesn't read pixel data, draw to a canvas, or `fetch()` the object.
Uploads go to the API as multipart POST, not browser→GCS. A CORS block would
configure an unused path while signalling that direct browser access is
expected — the wrong mental model for this bucket. Add it *if* the app ever
moves to signed-URL direct uploads; there's a commented template in
`storage.tf`.

---

## There are no secrets, so there is no Secret Manager

Worth stating plainly, because the absence looks like an oversight:

**This application has no secrets.** Not "secrets we've hidden well" —
none exist.

- The API authenticates to Firestore, Storage and Firebase Auth with
  **Application Default Credentials** from its attached service account. No
  key file is downloaded, stored, or mounted.
- Signed URLs are the usual reason a key file appears. Not here: the runtime
  SA holds `roles/iam.serviceAccountTokenCreator` **on itself**, so the
  client libraries sign via the IAM `signBlob` API using the ambient
  credential. No private key material ever exists. That single grant is what
  makes this whole section true — see the comment in `iam.tf`.
- The remaining config is non-sensitive: a project ID, a bucket name, a
  domain allowlist, a URL, a contest ID.
- `BOOTSTRAP_ADMIN_EMAIL` is *privileged* but not *secret* — an email
  address on the allowed domain, consulted once on first sign-in and then
  ignored. It's a Terraform variable rather than a hardcoded string so a
  fresh project doesn't inherit someone else's admin, not because it needs
  encrypting.

Adding Secret Manager would mean provisioning a secret, granting an
accessor role, wiring a volume or env reference, and maintaining rotation —
all to protect values that are printed in `terraform output`. That's
ceremony, not security. `secretmanager.googleapis.com` is therefore **not**
enabled, despite appearing in the runbook's API list.

If the app ever gains a real secret — a custom SMTP credential for the
magic-link sender is the plausible one — revisit this. Use
`google_secret_manager_secret` + `env { value_source { secret_key_ref } }`
in `cloud-run.tf`; don't put it in a plain env var.

---

## IAM, in one table

The runbook's framing: *"The API's service account gets Firestore and Storage
access. Nothing else does — that's what makes the anonymity guarantee hold
at the infrastructure layer rather than just in code."*

| Grant | Scope | Why |
|---|---|---|
| `roles/datastore.user` | project | read/write documents. Not `datastore.owner` — index management is Terraform's job |
| `roles/storage.objectAdmin` | **the logo bucket only** | create/read/overwrite/delete submission objects |
| `roles/firebaseauth.admin` | project | verify ID tokens, set the `admin` custom claim |
| `roles/iam.serviceAccountTokenCreator` | **the SA, on itself** | sign V4 URLs without a key file — see above |
| `roles/logging.logWriter` | project | a custom SA gets no logging by default; without it the service runs and logs nothing |
| `roles/monitoring.metricWriter` | project | metrics |

Not granted, on purpose: `roles/editor`, `roles/storage.admin`,
`roles/datastore.owner`, `roles/firebase.admin`, anything under
`roles/secretmanager.*`.

The bucket grant is **bucket-scoped**. Project-level storage access would
also hand the API the Terraform state bucket and any future Firestore export
bucket, for zero benefit. If this SA is ever compromised, the blast radius
should be the logo images — which an attacker could mostly see through the
app anyway.

Cloud Run runs as this SA, never the default compute service account (which
typically carries `roles/editor`).

---

## Pointing it at a fresh project

Nothing is hardcoded to `n7-logo-contest`:

```bash
scripts/bootstrap.sh --project-id my-new-project
# edit infra/terraform.tfvars: project_id, app_url, bootstrap_admin_email
scripts/deploy.sh --project-id my-new-project
```

Also update `.firebaserc` (`projects.default`) so the Firebase CLI targets
the same project — that one is outside this directory's ownership.

Using local state? Each project needs its own state file. Use a separate
checkout, or switch to the GCS backend with a per-project `prefix`.

---

## State

Local, in `infra/terraform.tfstate`, gitignored. Correct for one operator on
a throwaway project.

Switch to GCS the moment a **second person** needs to apply, or you want
state to survive a laptop reimage:

```bash
scripts/bootstrap.sh --project-id PROJECT --state-bucket PROJECT-tfstate
# uncomment the backend "gcs" block in versions.tf, set the bucket name
terraform -chdir=infra init -migrate-state
```

---

## Teardown

Two guard rails are on by default and will block a destroy until you mean
it: `deletion_protection` on the Cloud Run service and
`delete_protection_state` on the Firestore database.

**Take an export first if real submissions exist.** It costs cents at this
size and it's the only undo:

```bash
gcloud firestore export "gs://${PROJECT_ID}-backups/$(date +%Y%m%d-%H%M)"
gcloud storage cp -r "gs://${PROJECT_ID}-logos" ./logo-backup/
```

Then:

```bash
# 1. Disable the guards in cloud-run.tf and firestore.tf, and apply.
# 2. terraform -chdir=infra destroy
```

The bucket won't destroy while it holds objects — that's intentional.
Empty it explicitly once you're certain.

**The clean option is deleting the project.** Everything lives in one
project precisely so the blast radius is contained:

```bash
gcloud projects delete "${PROJECT_ID}"
```

That leaves nothing behind, including the APIs `apis.tf` enabled (which is
also why they're set to `disable_on_destroy = false` — a `terraform destroy`
shouldn't lobotomise a project you might share).

---

## Resting cost: approximately zero

| Resource | At rest |
|---|---|
| Cloud Run | **$0** — scales to zero, `cpu_idle = true`, no minimum instances |
| Firestore | free tier (1 GiB, 50k reads/day). ~25 users × a few hundred docs isn't close |
| Cloud Storage | free tier (5 GB). ~25 logos at a few MB each |
| Artifact Registry | free tier (0.5 GB), then ~$0.10/GB/month. A handful of ~200 MB images ≈ **cents** |
| Firebase Hosting | free tier (10 GB storage, 360 MB/day transfer) |
| Firebase Auth | free for email-link |
| Logging | free tier (50 GiB/month) |

Between contests the only non-zero line is Artifact Registry, at cents per
month. During a contest it stays inside the free tier.

The real cost risk isn't traffic — it's a runaway loop. `max_instances`
defaults to **3** as the cheapest available circuit breaker.
