# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:22.22.0-bookworm-slim

FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global npm@11.9.0 --no-audit --no-fund
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --legacy-peer-deps --no-audit --no-fund

FROM dependencies AS build
COPY . .
RUN mkdir -p public && npm run build

FROM ${NODE_IMAGE} AS production-dependencies
WORKDIR /app
RUN npm install --global npm@11.9.0 --no-audit --no-fund
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --legacy-peer-deps --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# The repository-defined worker entrypoint uses tsx. Add only tsx and its
# platform-specific esbuild runtime to the production dependency tree.
FROM production-dependencies AS worker-dependencies
COPY --from=dependencies /app/node_modules/tsx ./node_modules/tsx
COPY --from=dependencies /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=dependencies /app/node_modules/@esbuild ./node_modules/@esbuild
RUN ln -sf ../tsx/dist/cli.mjs ./node_modules/.bin/tsx

FROM ${NODE_IMAGE} AS worker
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    USE_DATABASE=true \
    AUTH_DEV_HEADER=false
COPY --from=worker-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json tsconfig.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node db ./db
COPY --chown=node:node scripts ./scripts
USER node
CMD ["npm", "run", "worker"]

FROM ${NODE_IMAGE} AS web
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    USE_DATABASE=true \
    AUTH_DEV_HEADER=false \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node package.json package-lock.json next.config.ts ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["npm", "run", "start"]
