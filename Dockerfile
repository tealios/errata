# syntax=docker/dockerfile:1

# ── Build stage ──────────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS build

WORKDIR /app

# Install build dependencies (alpine: glibc-compatible libs for native modules)
RUN apk add --no-cache git

# Copy package files and local SDK package first (layer caching)
COPY package.json ./
COPY packages/ packages/

# Install all dependencies (including file: local packages)
RUN bun install

# Copy the rest of the source
COPY . .

# Build the app (TanStack Start → Nitro output in .output/)
ARG BUILD_VERSION=unknown
ENV BUILD_VERSION=${BUILD_VERSION}
RUN bun run build

# ── Production stage ─────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS production

LABEL org.opencontainers.image.source="https://github.com/tealios/errata"

WORKDIR /app

# Copy only the built output from the build stage
COPY --from=build /app/.output /app/.output
COPY --from=build /app/public /app/public
COPY --from=build /app/plugins /app/plugins

# Use the bun user (UID 1000) to match host user permissions
USER bun

ENV DATA_DIR=/app/data
ENV PORT=7739

EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + process.env.PORT + '/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["bun", ".output/server/index.mjs"]
