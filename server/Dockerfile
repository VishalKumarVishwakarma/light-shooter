# Game server image for Koyeb (and any Docker host).
#
# Context MUST be the repo root, not server/:
#
#   docker build -f server/Dockerfile -t shooter-server .
#   docker run -p 2567:2567 -e PORT=2567 shooter-server
#
# The client is NOT in this image. It deploys separately as static files and is
# served over https, because a page served over https cannot open a ws:// socket
# (mixed content) -- so the server must be reached over wss://.
#
# Two stages, so the dev dependencies (typescript, @types/*) never reach the
# running image.
#
# WHY THE INSTALL COMMANDS LOOK ODD
# The root package.json declares workspaces: [client, server], but the repo also
# ships a separate server/package-lock.json. `npm ci --workspace=server` therefore
# installs the server's deps NESTED under server/node_modules rather than hoisted
# to the root. That is verified working, not assumed: the install was run in a
# scratch dir, then `npm --prefix server run build` compiled cleanly and the
# resulting dist/index.js served /health and /lobbies on a spare port.
#
# The workspace flag also does the useful thing -- the client's phaser, vite and
# qrcode-generator are NOT installed, so they cannot be baked in by accident.

# ---- stage 1: compile TypeScript -------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Manifests first, so the install layer is cached until a dependency actually
# changes. Copying source before install would bust the cache on every edit.
COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --workspace=server --include-workspace-root

COPY server/tsconfig.json ./server/
COPY server/src ./server/src
RUN npm --prefix server run build

# ---- stage 2: runtime ------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Koyeb and most PaaS inject PORT; server/src/index.ts already reads it and
# defaults to 2567 for local runs.
ENV PORT=2567

# Production deps only, in the same nested layout the build stage produced, so
# the resolution paths match exactly.
COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --omit=dev --workspace=server --include-workspace-root \
  && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist

# `node` rather than `npm start`, so SIGTERM reaches the process directly and
# Colyseus gets to tear rooms down cleanly on a redeploy.
CMD ["node", "server/dist/index.js"]
