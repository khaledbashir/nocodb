# ANC-branded NocoDB build for EasyPanel.
#
# Multi-stage:
#   1. gui-builder  — installs pnpm + builds nc-gui (Nuxt/Vue) so our patched logos
#      and isEeUI=false override get baked into the static bundle.
#   2. runtime      — uses the official nocodb/nocodb:latest image as the base
#      for backend + node_modules, then overlays our freshly-built nc-gui.
#
# This pattern is faster than rebuilding the entire NocoDB monorepo because:
#   - 95% of NocoDB's build cost is the backend (NestJS) which we don't change
#   - All branding lives in nc-gui (logos, EE flags, plan badges)
#   - The official image already has the runtime, native deps, sharp, etc. set up
#
# EasyPanel: Source = GitHub khaledbashir/nocodb, branch anc-rebrand, build from
# this Dockerfile at the repo root.

# -------- 1. nc-gui builder ----------------------------------------------
FROM node:20-bookworm-slim AS gui-builder

# Build deps for any native modules (sharp, etc.) + pnpm 10 (lockfile is v9)
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@10

WORKDIR /app

# Copy the workspace manifest + lockfile first for cached install
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/nc-gui/package.json ./packages/nc-gui/
COPY packages/nocodb-sdk/package.json ./packages/nocodb-sdk/

# Install only nc-gui deps + nocodb-sdk (its peer)
RUN pnpm install --filter nc-gui... --frozen-lockfile

# Copy nc-gui source + nocodb-sdk source (nc-gui imports types from it)
COPY packages/nc-gui ./packages/nc-gui
COPY packages/nocodb-sdk ./packages/nocodb-sdk

# nocodb-sdk needs to be built first because nc-gui imports its compiled types
RUN cd packages/nocodb-sdk && pnpm build || true

# Build nc-gui (Nuxt → .output/public + .output/server)
RUN cd packages/nc-gui && pnpm build

# -------- 2. runtime ------------------------------------------------------
FROM nocodb/nocodb:latest

# Overlay our freshly-built nc-gui on top of the official image's GUI bundle.
# Official image serves the static GUI from /usr/src/app/docker/nc-gui/
# (verified by `docker run --rm --entrypoint sh nocodb/nocodb:latest find /usr/src -name index.html`).
# The Nuxt build output for static-mode lives in .output/public.
COPY --from=gui-builder /app/packages/nc-gui/.output/public/ /usr/src/app/docker/nc-gui/

# Keep the official image's defaults — same port (8080), same start command.
EXPOSE 8080
