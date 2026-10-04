# Media Moguls (North 7) Logo Design Contest

A full-stack, privacy-preserving web application for running an end-to-end design contest and ranked-choice voting election. Built for high security, airtight author anonymity, and provably fair ballot counting.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture & Tech Stack](#architecture--tech-stack)
- [Repository Structure](#repository-structure)
- [Contest Lifecycle & IRV Mechanics](#contest-lifecycle--irv-mechanics)
- [Security & Privacy Guarantees](#security--privacy-guarantees)
- [Local Development](#local-development)
  - [Prerequisites](#prerequisites)
  - [Setup & Installation](#setup--installation)
  - [Firebase Emulators & Seed Data](#firebase-emulators--seed-data)
  - [Running Tests](#running-tests)
- [Deployment Guide](#deployment-guide)
  - [Prerequisites & GCP Setup](#prerequisites--gcp-setup)
  - [Domain Restricted Sharing (DRS) Note](#domain-restricted-sharing-drs-note)
  - [Firebase Auth Configuration](#firebase-auth-configuration)
  - [Infrastructure Provisioning (Terraform)](#infrastructure-provisioning-terraform)
  - [Building & Deploying with `scripts/deploy.sh`](#building--deploying-with-scriptsdeploysh)
  - [Manual Step-by-Step Deployment](#manual-step-by-step-deployment)
- [Publishing to GitHub (`sir-rob`)](#publishing-to-github-sir-rob)
- [License](#license)

---

## Overview

The **Media Moguls (North 7) Logo Design Contest** application provides a streamlined, transparent, and fair platform for team members to submit logo designs, review candidates, and vote using **Instant Runoff Voting (IRV)** / Ranked Choice Voting.

The system was designed from the ground up to eliminate bias and prevent premature information disclosure:
- **Zero-knowledge author identities**: Entries are blinded until the winner is officially announced.
- **Strict metadata sanitization**: Uploaded artwork has all EXIF/IPTC/XMP camera, geolocation, and creator metadata stripped server-side.
- **Zero-leak ballot secrecy**: Even administrators cannot view or export individual voter ballots—only aggregate, round-by-round IRV tallies are revealed.

---

## Key Features

- **Passwordless Magic Link Authentication**: Powered by Firebase Auth for secure, frictionless corporate email login with no passwords to manage or compromise.
- **Automated Image Processing Pipeline**:
  - Validates MIME types, byte headers, aspect ratios, and dimensions.
  - Byte-level EXIF metadata stripping via `sharp`.
  - Automated rendition generation: Full display (WebP/PNG), preview cards, and thumbnail sizes.
- **Accessible Ranked-Choice Ballot**:
  - Full keyboard and screen-reader accessible drag-and-drop ranking powered by `@dnd-kit`.
  - Instant validation preventing duplicate rankings or invalid preferences.
- **Audited State Machine**:
  - Enforces strict contest phase transitions: `DRAFT` &rarr; `SUBMISSION` &rarr; `REVIEW` &rarr; `VOTING` &rarr; `COUNTING` &rarr; `REVEAL`.
  - Immutable audit logs record every administrative phase change and moderation event.
- **Instant Runoff Voting (IRV) Engine**:
  - Fully deterministic, multi-round runoff counting algorithm.
  - Handles exhausted ballots, threshold recalculations (>50% majority), and deterministic tie-breaking.
- **Production-Grade GCP Infrastructure**:
  - Containerized backend on Google Cloud Run (scale-to-zero).
  - Private Google Cloud Storage with Public Access Prevention (PAP) and Uniform Bucket-Level Access (UBLA).
  - Firestore Native database with fine-grained security rules.
  - Firebase Hosting globally cached frontend with rewrites to Cloud Run.

---

## Architecture & Tech Stack

```
                     +---------------------------------------+
                     |           Client Browser              |
                     |  (React 18 + Vite + Tailwind + dnd)   |
                     +-------------------+-------------------+
                                         |
                   +---------------------+---------------------+
                   | HTTPS                                     |
                   v                                           v
      +-------------------------+                 +-------------------------+
      |     Firebase Hosting    |                 |   Firebase Auth         |
      |   (Static Web Assets)   |                 | (Passwordless MagicLink)|
      +------------+------------+                 +------------+------------+
                   |                                           |
                   | /api/* rewrite                            | ID Token
                   v                                           v
      +-----------------------------------------------------------------+
      |                 Google Cloud Run (contest-api)                  |
      |                   Fastify + TypeScript + Sharp                  |
      +--------------------+-----------------------+--------------------+
                           |                       |
                           v                       v
               +-----------------------+ +--------------------+
               |   Google Cloud        | |  Google Firestore  |
               |  Storage (Private)    | | (Native Mode DB)   |
               | (Originals/Renditions)| |                    |
               +-----------------------+ +--------------------+
```

### Monorepo Stack
- **Monorepo Architecture**: `npm` workspaces with TypeScript project references (`tsconfig.base.json`).
- **Web Client (`apps/web`)**: React 18, Vite, TypeScript, Tailwind CSS, Radix UI primitives (`shadcn/ui`), Lucide icons, `@dnd-kit` (drag and drop).
- **API Server (`apps/api`)**: Node.js 20, Fastify, Firebase Admin SDK, `@google-cloud/storage`, `sharp` image processing, `zod` contract validation, non-root multi-stage Docker container.
- **Shared Contracts (`packages/shared`)**: Domain types, Zod schemas, IRV counting engine, phase validation, and centralized API error hierarchies.
- **Infrastructure as Code (`infra/`)**: Modular Terraform configurations for Google Cloud Platform.
- **Testing**: `vitest` (358+ tests spanning unit, IRV algorithms, and adversarial anonymity leak tests).

---

## Repository Structure

```
.
├── apps/
│   ├── api/                    # Fastify REST API backend
│   │   ├── Dockerfile          # Multi-stage secure Docker build (node:20-slim)
│   │   ├── src/
│   │   │   ├── db/             # Firestore repositories & data mappers
│   │   │   ├── irv/            # Instant Runoff Voting implementation
│   │   │   ├── middleware/     # Auth & role-based access control
│   │   │   ├── plugins/        # Fastify plugins (error handling, auth, storage)
│   │   │   ├── routes/         # API route handlers (entries, voting, phases, admin)
│   │   │   ├── services/       # Image processing, EXIF stripping, GCS integration
│   │   │   └── app.ts          # Fastify application setup
│   │   └── package.json
│   │
│   └── web/                    # React single-page frontend
│       ├── src/
│       │   ├── auth/           # Firebase Auth provider & sign-in components
│       │   ├── components/     # UI components (dnd-kit ballot, entry cards, dialogs)
│       │   ├── pages/          # Gallery, submit, vote, admin, results views
│       │   ├── App.tsx         # Main application container
│       │   └── routes.tsx      # Route declarations & phase gates
│       └── package.json
│
├── packages/
│   └── shared/                 # Monorepo shared package
│       ├── src/
│       │   ├── api.ts          # Request/response DTO schemas
│       │   ├── constants.ts    # System limits, dimensions, allowed MIME types
│       │   ├── entities.ts     # Core domain interfaces
│       │   ├── errors.ts       # Uniform error taxonomy
│       │   ├── phases.ts       # Contest phase state machine
│       │   └── results.ts      # IRV tally contracts
│       └── package.json
│
├── infra/                      # Terraform infrastructure configurations
│   ├── apis.tf                 # GCP service enablement
│   ├── artifact-registry.tf    # Docker container registry
│   ├── cloud-run.tf            # Backend service specification & autoscaling
│   ├── firestore.tf            # Firestore database & rules
│   ├── hosting.tf              # Firebase Hosting site & rewrites
│   ├── iam.tf                  # Least-privilege Service Accounts & roles
│   ├── storage.tf              # Private GCS bucket, PAP, lifecycle policies
│   ├── variables.tf            # Parameter definitions
│   └── outputs.tf              # Target endpoints & resource IDs
│
├── scripts/
│   ├── bootstrap.sh            # Idempotent GCP project initialization script
│   ├── deploy.sh               # Immutable SHA-tagged build & deployment pipeline
│   ├── seed.ts                 # Test data generator (mock entries, users, runoff ties)
│   └── verify-exif-strip.ts    # Byte-level metadata leak verification tool
│
├── firestore.rules             # Firestore security rules
├── storage.rules               # Cloud Storage security rules
├── firebase.json               # Firebase CLI & emulator configuration
├── Makefile                    # Developer shortcut commands
└── package.json                # Root workspaces definition
```

---

## Contest Lifecycle & IRV Mechanics

The contest proceeds through six strictly ordered phases governed by `packages/shared/src/phases.ts`:

```
   [DRAFT]  --->  [SUBMISSION]  --->  [REVIEW]  --->  [VOTING]  --->  [COUNTING]  --->  [REVEAL]
(Setup contest)  (Users upload)   (Admin curate)  (Ranked ballot)   (IRV tally)    (Winners &
                                                                                   authors unblinded)
```

### Instant Runoff Voting (IRV) Algorithm
1. **First Preference Tally**: Each ballot's highest-ranked eligible candidate receives one vote.
2. **Majority Check**: If any candidate captures **>50%** of active, non-exhausted votes, that candidate is declared the winner.
3. **Candidate Elimination**: The candidate with the fewest votes in the current round is eliminated.
4. **Preference Redistribution**: Ballots cast for the eliminated candidate transfer to each voter's next-highest ranked surviving choice.
5. **Ballot Exhaustion**: When all candidates listed on a ballot are eliminated, the ballot is marked *exhausted* and deducted from the active denominator.
6. **Tie-Breaking**: If candidates tie for elimination, deterministic fallback rules (initial first-choice count, previous round standing, or seeded pseudo-random hash) resolve the tie.

---

## Security & Privacy Guarantees

1. **Airtight Anonymity**:
   - Submissions receive randomized synthetic IDs.
   - Author metadata is stored separately in an internal admin collection inaccessible via public APIs.
   - Author identities are never sent to the client until the contest reaches the `REVEAL` phase.
2. **EXIF & Metadata Sanitization**:
   - `apps/api/src/services/image.ts` uses `sharp` to strip all metadata chunks (EXIF, IPTC, XMP, ICC profile comments) during ingestion.
   - Stored and served images carry zero hardware, GPS, timestamp, or creator metadata.
3. **Ballot Privacy**:
   - Ballots are stored with hashed user references to prevent voter tracking.
   - APIs do not provide any endpoint to read individual ballots. Even project administrators cannot export or view individual votes.
4. **Cloud Storage Hardening**:
   - Storage buckets enforce **Public Access Prevention (PAP)** and **Uniform Bucket-Level Access (UBLA)**.
   - Images are served through authorized Cloud Run signed URLs or backend streams; no public GCS bucket permissions exist.

---

## Local Development

### Prerequisites

- **Node.js**: v20.x or higher
- **npm**: v10.x or higher
- **Java JRE**: v11+ (required to run Firebase Local Emulators)
- **Firebase CLI**: Installed globally or invoked via root `devDependencies` (`npx firebase`)

### Setup & Installation

1. **Clone the repository and install dependencies**:
   ```bash
   git clone https://github.com/sir-rob/logo-contest.git
   cd logo-contest
   npm install
   ```

2. **Configure local environment files**:
   ```bash
   # Copy root emulator environment settings
   cp .env.local.example .env.local

   # Copy frontend environment settings
   cp apps/web/.env.development apps/web/.env.local
   ```

3. **Build the shared library**:
   ```bash
   npm run build --workspace=@contest/shared
   ```

### Firebase Emulators & Seed Data

1. **Start the Firebase Emulators** (Auth, Firestore, Storage, Hosting):
   ```bash
   npm run emulators
   ```
   *The emulator UI is accessible at `http://localhost:4000`.*

2. **Seed the database with sample data** (in a separate terminal):
   ```bash
   npm run seed
   ```
   *This seeds mock users (admin and voters), sample logo entries with stripped renditions, and ballots configured to demonstrate a multi-round IRV runoff.*

3. **Start the development servers**:
   ```bash
   npm run dev
   ```
   - Frontend: `http://localhost:5173`
   - API: `http://localhost:8080`

### Running Tests

The test suite includes unit tests, IRV runoff calculations, and adversarial anonymity tests:

```bash
# Run all vitest suites
npm test

# Run tests in watch mode
npm run test:watch

# Run TypeScript typechecks across all workspaces
npm run typecheck

# Run linter
npm run lint
```

---

## Deployment Guide

### Prerequisites & GCP Setup

1. **Google Cloud SDK (`gcloud`)**: Authenticated with owner or editor permissions:
   ```bash
   gcloud auth login
   gcloud auth application-default login
   ```
2. **Terraform**: v1.5 or newer installed locally.
3. **Firebase CLI**: Authenticated (`firebase login`).
4. **Create a target GCP project**:
   ```bash
   export PROJECT_ID="your-contest-project-id"
   gcloud projects create ${PROJECT_ID} --name="North 7 Logo Contest"
   # Link your billing account
   gcloud beta billing projects link ${PROJECT_ID} --billing-account=YOUR_BILLING_ACCOUNT_ID
   ```

### Domain Restricted Sharing (DRS) Note

If deploying inside an enterprise Google Cloud Organization (e.g., Argolis) where the **Domain Restricted Sharing (`constraints/iam.allowedPolicyMemberDomains`)** constraint is enforced, Cloud Run's public invocation (`allUsers` role `roles/run.invoker`) will be blocked by default.

To grant an exception for your contest project:
```bash
cat > /tmp/drs-exception.yaml <<EOF
name: projects/${PROJECT_ID}/policies/iam.allowedPolicyMemberDomains
spec:
  rules:
    - allowAll: true
EOF

gcloud org-policies set-policy /tmp/drs-exception.yaml
rm /tmp/drs-exception.yaml
```

### Firebase Auth Configuration

1. In the [Firebase Console](https://console.firebase.google.com/), add Firebase to your GCP project.
2. Navigate to **Authentication** &rarr; **Sign-in method**.
3. Enable **Email/Password** and toggle on **Email link (passwordless sign-in)**.
4. Under **Authorized domains**, add:
   - Your Firebase Hosting domain (`${PROJECT_ID}.web.app` and `${PROJECT_ID}.firebaseapp.com`)
   - Custom domains (if applicable)

### Automated Deployment with `scripts/deploy.sh`

The repository includes an end-to-end deployment script that builds container images tagged with the current Git commit SHA (guaranteeing immutable, safe rollback references), applies Terraform, and deploys frontend assets:

```bash
# First-time project setup (enables APIs, verifies org policies, initializes Terraform)
./scripts/bootstrap.sh --project-id ${PROJECT_ID} --region us-east4

# Perform a dry-run deploy to preview actions
./scripts/deploy.sh --project-id ${PROJECT_ID} --region us-east4 --dry-run

# Run the complete deployment
./scripts/deploy.sh --project-id ${PROJECT_ID} --region us-east4
```

### Manual Step-by-Step Deployment

If you prefer to run each step manually:

1. **Build & Push API Container**:
   ```bash
   COMMIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "v0.1.0")
   REGION="us-east4"
   IMAGE="us-east4-docker.pkg.dev/${PROJECT_ID}/contest/contest-api:${COMMIT_SHA}"

   # Enable Artifact Registry and build image
   gcloud builds submit --tag ${IMAGE} --project ${PROJECT_ID} apps/api
   ```

2. **Apply Terraform**:
   ```bash
   cd infra
   terraform init
   terraform apply \
     -var="project_id=${PROJECT_ID}" \
     -var="region=${REGION}" \
     -var="api_image=${IMAGE}"
   cd ..
   ```

3. **Build & Deploy Web Client**:
   ```bash
   # Build the production web bundle
   VITE_API_URL="/api" npm run build --workspace=@contest/web

   # Deploy Firebase Hosting, Firestore rules, and Storage rules
   firebase use ${PROJECT_ID}
   firebase deploy --only hosting,firestore:rules,storage:rules
   ```

---

## Publishing to GitHub (`sir-rob`)

To push this codebase to your GitHub account under `sir-rob`, follow these steps:

### 1. Initialize the Local Git Repository
From the root of the project:
```bash
git init
git add .
git commit -m "Initial commit: Media Moguls (North 7) Logo Design Contest application"
```

### 2. Create the Remote Repository on GitHub

#### Option A: Using the GitHub CLI (`gh`)
```bash
# Authenticate if not already logged in
gh auth login

# Create the repository under your account and push
gh repo create sir-rob/logo-contest --public --source=. --remote=origin --push
```

#### Option B: Using Standard Git & GitHub Web UI
1. Go to [github.com/new](https://github.com/new) and create a repository named `logo-contest` under the `sir-rob` account.
2. Link the remote and push:
   ```bash
   git branch -M main
   git remote add origin https://github.com/sir-rob/logo-contest.git
   git push -u origin main
   ```

---

## License

Internal proprietary application for the Media Moguls (North 7) team.
