# Deploy Runbook — Argolis

**Item D19.** The steps that need your Google Cloud session and org-admin rights.
Terraform (D18) handles everything inside the project; this covers the things
Terraform can't do for itself — creating the project, clearing org policy, and
configuring Firebase Auth.

Run these with me, in order. Steps 1–3 are the ones that can hard-block us, so
we do them before anything gets built in the cloud.

---

## Pre-flight

Current gcloud context on this machine:

- Account: `admin@saurabhma.altostrat.com`
- Active project: `sm-cowork` (**not** what we want — we create a new one)

Confirmed 2026-09-13:

| Value | Setting |
|---|---|
| `ALLOWED_DOMAIN` | `google.com` |
| App URL | Default Firebase Hosting `n7-logo-contest.web.app` — no custom domain |

---

## ⚠️ Risk to settle early: magic-link deliverability

**The OAuth consent risk is gone.** Sign-in is now an email magic link, so no
OAuth client is involved and the corp restriction on authorizing third-party
apps never applies. That was the right call.

It does move the risk rather than remove it. The new failure mode is **mail
delivery**: corp inbound filtering may treat a "click here to sign in" link
from an unfamiliar sending domain as phishing — precisely the pattern security
training tells people to distrust. The mail could land in spam, get link-rewritten,
or be stripped.

Same blast radius as before: if it fails, nobody signs in.

**Test it early — it takes ten minutes and needs nothing else built.** Enable
Firebase Auth email-link sign-in in the project and send yourself a link at your
real `@google.com` address.

| Result | What we do |
|---|---|
| Arrives in inbox, link works | Done. Proceed |
| Lands in spam | Usable but bad. Configure a custom SMTP sender and warn the team to check spam on first sign-in |
| Never arrives, or link is stripped/rewritten | Fall back to a 6-digit one-time code (below) |

**Fallback: one-time code instead of a link.** Email a 6-digit code, have the
user type it, verify server-side and mint a session with firebase-admin's
`createCustomToken`. A short numeric code trips far fewer phishing heuristics
than a long clickable auth URL, and it sidesteps the cross-device problem
entirely. It costs an email-sending path we'd have to wire up ourselves, so it
is deliberately NOT built yet — but the auth layer is structured so it can be
added behind the same interface.

**Worth doing regardless:** tell the team the email is coming, who it's from, and
what it looks like, before you send 25 of them. An unexpected sign-in link to a
Googler is a phishing report waiting to happen.

---

## 1. Create the project

```bash
PROJECT_ID="n7-logo-contest"          # must be globally unique
BILLING_ACCOUNT="$(gcloud beta billing accounts list --format='value(name)' --limit=1)"
ORG_ID="$(gcloud organizations list --format='value(ID)' --limit=1)"

gcloud projects create "$PROJECT_ID" --name="N7 Logo Contest" --organization="$ORG_ID"
gcloud beta billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
gcloud config set project "$PROJECT_ID"
```

## 2. Clear Domain Restricted Sharing — the blocker

`constraints/iam.allowedPolicyMemberDomains` blocks binding `allUsers`, which is
exactly what Firebase Hosting and a public Cloud Run service need. Argolis
enforces it org-wide by default. **This will stop the deploy cold if we skip it.**

We override it for this one project only — not the org.

```bash
cat > /tmp/drs-exception.yaml <<EOF
name: projects/${PROJECT_ID}/policies/iam.allowedPolicyMemberDomains
spec:
  rules:
    - allowValues:
        - "allUsers"
        - "allAuthenticatedUsers"
EOF

gcloud org-policies set-policy /tmp/drs-exception.yaml
gcloud org-policies describe iam.allowedPolicyMemberDomains --project="$PROJECT_ID"
```

If that returns a permission error, your account lacks
`roles/orgpolicy.policyAdmin` at the org node — grant it to yourself first:

```bash
gcloud organizations add-iam-policy-binding "$ORG_ID" \
  --member="user:admin@saurabhma.altostrat.com" \
  --role="roles/orgpolicy.policyAdmin"
```

Policy changes take a minute or two to propagate. A deploy attempted immediately
after can still fail — wait, then retry once before debugging anything else.

**Leave `constraints/storage.publicAccessPrevention` enforced.** The logo bucket
must stay private; images are served through short-lived signed URLs. No
exception needed, and we want that one working against us.

## 3. Enable APIs

```bash
gcloud services enable \
  run.googleapis.com firestore.googleapis.com firebase.googleapis.com \
  firebasehosting.googleapis.com identitytoolkit.googleapis.com \
  storage.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com iam.googleapis.com secretmanager.googleapis.com
```

## 4. Terraform the infrastructure

From `infra/` (produced by D18): Firestore in Native mode, the private bucket
with lifecycle rules, Artifact Registry, the Cloud Run service and its dedicated
service account, IAM, and Hosting.

```bash
cd infra && terraform init && terraform apply -var="project_id=${PROJECT_ID}"
```

The API's service account gets Firestore and Storage access. **Nothing else
does** — that's what makes the anonymity guarantee hold at the infrastructure
layer rather than just in code.

## 5. Firebase Auth

Console work, no CLI equivalent worth scripting:

1. Add Firebase to the project, enable **Email/Password → Email link
   (passwordless sign-in)** as the only provider.
2. Authorized domains: add `n7-logo-contest.web.app`.
3. Confirm **no other provider is enabled** — especially Anonymous, which would
   hand out sessions with no email at all and bypass the domain gate completely,
   and Google, which we deliberately are not using.
4. Customize the sign-in email template: a clear subject, name the contest, and
   say who it's from. The default template is generic enough to read as phishing
   to a security-trained recipient.
5. Send yourself a link at your real `@google.com` address and confirm it
   arrives in the inbox, not spam. **Do this before step 6** — it's the riskiest
   assumption in the whole deployment.

## 6. Deploy and bootstrap the first admin

```bash
npm run build
gcloud run deploy contest-api --source apps/api --region us-central1 \
  --set-env-vars "ALLOWED_DOMAIN=<domain>,GCP_PROJECT=${PROJECT_ID},BOOTSTRAP_ADMIN_EMAIL=<your-email>"
firebase deploy --only hosting,firestore:rules,storage:rules
```

`BOOTSTRAP_ADMIN_EMAIL` promotes exactly one account to admin on first sign-in,
then stops being consulted. Sign in first, confirm your admin claim, and from
then on promote everyone else through the admin console.

## 7. Smoke test — before inviting anyone

1. Sign in as yourself → land as admin.
2. **Sign in with a second account on the allowed domain** → lands as a member.
   This is the step that proves `ALLOWED_DOMAIN` is right.
3. Sign in with an off-domain account → cleanly rejected, no partial access.
4. Upload a logo; confirm in the bucket that the object has a UUID name and
   **no EXIF** (`exiftool` or `sharp` metadata read).
5. As the member account, confirm the gallery exposes no uploader identity —
   check the raw API response in devtools, not just the rendered page.
6. Cast a ballot, edit it, confirm the edit sticks.
7. Roll the phase to voting, then closed; confirm results compute and the
   round-by-round view renders.
8. Confirm an off-domain or non-admin token is refused on an `/admin/**` route.

## 8. Go live

Set the real dates, announce, and keep the admin console open on the turnout
view — at 10–25 people, one person forgetting to vote is ~5% of the electorate.

---

## Rollback

Everything is in one project, so the blast radius is contained: `terraform
destroy`, or delete the project outright. Firestore exports are cheap at this
size — take one before any risky change once real submissions exist:

```bash
gcloud firestore export "gs://${PROJECT_ID}-backups/$(date +%Y%m%d-%H%M)"
```
