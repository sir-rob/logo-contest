# syntax=docker/dockerfile:1.7
#
# API container image for the N7 logo contest.
#
# BUILD CONTEXT IS THE REPO ROOT, not apps/api:
#
#   docker build -f apps/api/Dockerfile -t IMAGE .
#
# This is an npm workspace. The API depends on packages/shared and on the
# root package-lock.json, neither of which is reachable from an apps/api
# context. scripts/deploy.sh does this correctly; .dockerignore keeps the
# larger context from actually costing anything.
#
# ---------------------------------------------------------------------------
# WHY node:20-slim AND NOT node:20-alpine
# ---------------------------------------------------------------------------
# sharp. Alpine is musl-based, and sharp's prebuilt libvips binaries are
# built against glibc. On Alpine you either get a musl build that has
# historically lagged and broken across sharp releases, or npm falls back to
# compiling libvips from source -- which needs a full build toolchain, adds
# minutes to every build, and inflates the image past anything Alpine saved.
# node:20-slim is Debian/glibc, so sharp's prebuilt binary installs cleanly,
# and the resulting image is comparable in size once libvips is accounted
# for. The 30MB Alpine "saves" is not worth an image-processing pipeline that
# fails in production and works locally.
# ---------------------------------------------------------------------------

# ===========================================================================
# Stage 1: build -- install ALL deps (incl. dev) and compile TypeScript
# ===========================================================================
FROM node:20-slim AS build

WORKDIR /app

ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Manifests first, so Docker's layer cache survives source-only changes.
# npm needs every workspace's package.json present before it will resolve
# the workspace graph, hence all four.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json        ./apps/api/
COPY apps/web/package.json        ./apps/web/

# `npm ci` for a reproducible, lockfile-exact install.
# --workspace flags restrict the install to the API and its shared dep: the
# web app's toolchain (Vite, Tailwind, React) has no business in an image
# that only ever runs a Fastify server.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --workspace @contest/api --workspace @contest/shared --include-workspace-root

# TypeScript config, then sources.
COPY tsconfig.base.json tsconfig.json ./
COPY packages/shared ./packages/shared
COPY apps/api        ./apps/api

# Compile shared first (the API imports its types), then the API.
RUN npm run build --workspace @contest/shared --if-present \
 && npm run build --workspace @contest/api

# ===========================================================================
# Stage 2: prune -- production-only node_modules, in isolation
# ===========================================================================
# Done as its own stage so the runtime image never sees a dev dependency,
# not even in a discarded layer.
FROM node:20-slim AS deps

WORKDIR /app

ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json        ./apps/api/
COPY apps/web/package.json        ./apps/web/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev \
      --workspace @contest/api --workspace @contest/shared \
      --include-workspace-root

# ===========================================================================
# Stage 3: runtime
# ===========================================================================
FROM node:20-slim AS runtime

# NODE_ENV=production before anything else: it changes how the app config
# validates itself (config.ts refuses to start if emulator hosts are set in
# production) and how several dependencies behave.
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# curl for the HEALTHCHECK below; ca-certificates for outbound TLS to the
# Google APIs. Nothing else -- every extra package is attack surface in an
# image that only runs one Node process.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# NON-ROOT. The node:20-slim image ships an unprivileged `node` user
# (uid 1000); use it rather than minting another. The app writes nothing to
# disk -- uploads are streamed to GCS -- so it needs no writable path beyond
# the OS temp dir.
#
# Ownership is set at COPY time via --chown, which avoids a costly recursive
# chmod layer over node_modules.
COPY --from=deps  --chown=node:node /app/node_modules              ./node_modules
COPY --from=deps  --chown=node:node /app/package.json              ./package.json
COPY --from=build --chown=node:node /app/apps/api/dist             ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/package.json     ./apps/api/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist      ./packages/shared/dist
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json

# Build provenance, so a running container can be traced to a commit.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
LABEL org.opencontainers.image.title="n7-logo-contest-api" \
      org.opencontainers.image.description="Media Moguls (North 7) Logo Design Contest API" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.base.name="docker.io/library/node:20-slim"

USER node

# PORT IS INJECTED BY CLOUD RUN -- the app reads process.env.PORT.
# 8080 here is only the documented default for local `docker run` and for
# the HEALTHCHECK below; it is NOT baked into the application. Cloud Run
# sets PORT from the service's containerPort (see infra/cloud-run.tf) and
# rejects any attempt to pass PORT as an env var, so the injected value
# always wins. Never hardcode 8080 in application code.
ENV PORT=8080
EXPOSE 8080

# HEALTHCHECK is for local/Compose use. Cloud Run ignores it entirely and
# uses the startup (/healthz) and liveness (/readyz) probes declared in
# infra/cloud-run.tf instead -- but having it here means `docker ps` tells
# the truth when someone runs the image by hand while debugging.
# ${PORT} is honoured so it stays correct if the port is overridden.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1

# Exec form: node becomes PID 1 and receives SIGTERM directly, so Cloud Run's
# shutdown signal reaches Fastify's graceful-close handler instead of being
# swallowed by a shell. No `npm start` wrapper for the same reason.
CMD ["node", "apps/api/dist/server.js"]
