# =============================================================================
# Multi-stage Dockerfile for DCC Synthetic Liquidity Engine
# =============================================================================
# Usage:
#   docker compose up --build           (builds all services)
#   docker compose up --build operator-api  (builds + starts one service)
#
# Each service is a separate target stage, sharing a single build layer.
# =============================================================================

# ---------------------------------------------------------------------------
# Stage: base — install pnpm + copy workspace manifests
# ---------------------------------------------------------------------------
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig*.json ./
COPY packages/ packages/
COPY services/ services/
COPY apps/ apps/

# ---------------------------------------------------------------------------
# Stage: deps — install all dependencies (dev + prod)
# ---------------------------------------------------------------------------
FROM base AS deps
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage: build — compile everything
# ---------------------------------------------------------------------------
FROM deps AS build
RUN pnpm run build

# ---------------------------------------------------------------------------
# Stage: prod-deps — install production-only dependencies
# ---------------------------------------------------------------------------
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod

# ---------------------------------------------------------------------------
# Stage: runner — slim runtime base shared by all service targets
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN addgroup -g 1001 -S dcc && adduser -S dcc -u 1001
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=prod-deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=prod-deps /app/package.json ./package.json

# Copy all built packages (shared libs needed by every service)
COPY --from=build /app/packages/ ./packages/
USER dcc

# ======================= SERVICE TARGETS ===================================

# --- apps/ targets ---------------------------------------------------------

FROM runner AS operator-api
COPY --from=build /app/apps/operator-api/ ./apps/operator-api/
CMD ["node", "apps/operator-api/dist/index.js"]

FROM runner AS escrow-api
COPY --from=build /app/apps/escrow-api/ ./apps/escrow-api/
CMD ["node", "apps/escrow-api/dist/index.js"]

FROM runner AS relayer-api
COPY --from=build /app/apps/relayer-api/ ./apps/relayer-api/
CMD ["node", "apps/relayer-api/dist/index.js"]

# --- services/ targets -----------------------------------------------------

FROM runner AS execution-tracker
COPY --from=build /app/services/execution-tracker/ ./services/execution-tracker/
CMD ["node", "services/execution-tracker/dist/index.js"]

FROM runner AS relayer-monitor
COPY --from=build /app/services/relayer-monitor/ ./services/relayer-monitor/
CMD ["node", "services/relayer-monitor/dist/index.js"]

FROM runner AS venue-health-monitor
COPY --from=build /app/services/venue-health-monitor/ ./services/venue-health-monitor/
CMD ["node", "services/venue-health-monitor/dist/index.js"]

FROM runner AS market-health-monitor
COPY --from=build /app/services/market-health-monitor/ ./services/market-health-monitor/
CMD ["node", "services/market-health-monitor/dist/index.js"]

FROM runner AS synthetic-risk-monitor
COPY --from=build /app/services/synthetic-risk-monitor/ ./services/synthetic-risk-monitor/
CMD ["node", "services/synthetic-risk-monitor/dist/index.js"]

FROM runner AS alert-engine
COPY --from=build /app/services/alert-engine/ ./services/alert-engine/
CMD ["node", "services/alert-engine/dist/index.js"]

FROM runner AS protocol-control
COPY --from=build /app/services/protocol-control/ ./services/protocol-control/
CMD ["node", "services/protocol-control/dist/index.js"]

FROM runner AS market-data-service
COPY --from=build /app/services/market-data-service/ ./services/market-data-service/
CMD ["node", "services/market-data-service/dist/index.js"]

FROM runner AS quote-engine
COPY --from=build /app/services/quote-engine/ ./services/quote-engine/
CMD ["node", "services/quote-engine/dist/index.js"]

FROM runner AS router-service
COPY --from=build /app/services/router-service/ ./services/router-service/
CMD ["node", "services/router-service/dist/index.js"]

FROM runner AS execution-service
COPY --from=build /app/services/execution-service/ ./services/execution-service/
CMD ["node", "services/execution-service/dist/index.js"]

FROM runner AS relayer-service
COPY --from=build /app/services/relayer-service/ ./services/relayer-service/
CMD ["node", "services/relayer-service/dist/index.js"]

FROM runner AS execution-worker
COPY --from=build /app/services/execution-worker/ ./services/execution-worker/
CMD ["node", "services/execution-worker/dist/index.js"]

FROM runner AS inventory-manager
COPY --from=build /app/services/inventory-manager/ ./services/inventory-manager/
CMD ["node", "services/inventory-manager/dist/index.js"]

FROM runner AS hedging-engine
COPY --from=build /app/services/hedging-engine/ ./services/hedging-engine/
CMD ["node", "services/hedging-engine/dist/index.js"]

FROM runner AS reconciliation-service
COPY --from=build /app/services/reconciliation-service/ ./services/reconciliation-service/
CMD ["node", "services/reconciliation-service/dist/index.js"]

FROM runner AS quote-refresher
COPY --from=build /app/services/quote-refresher/ ./services/quote-refresher/
CMD ["node", "services/quote-refresher/dist/index.js"]

FROM runner AS escrow-service
COPY --from=build /app/services/escrow-service/ ./services/escrow-service/
CMD ["node", "services/escrow-service/dist/index.js"]
