#!/usr/bin/env bash
# =============================================================================
# DCC Synthetic Liquidity Engine — Local Development Launcher
# =============================================================================
# Starts all backend services + frontend for local development.
# Prerequisites: Node 20+, pnpm, Postgres running on :5432, Redis on :6379
#
# Usage:
#   ./scripts/dev-local.sh          # start everything
#   ./scripts/dev-local.sh stop     # stop all background services
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT_DIR/.dev-logs"
PID_FILE="$ROOT_DIR/.dev-pids"

# ── Common env vars ─────────────────────────────────────────────────────
export NODE_ENV=development
export LOG_LEVEL=debug
export DATABASE_URL="${DATABASE_URL:-postgresql://dylanshilts@localhost:5432/dcc_liquidity}"
export DB_POOL_MIN=2
export DB_POOL_MAX=10
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export DCC_NODE_URL="${DCC_NODE_URL:-https://mainnet-node.decentralchain.io}"
export DCC_CHAIN_ID=${DCC_CHAIN_ID:-\?}
export DCC_SEED="${DCC_SEED:-}"
export JUPITER_API_URL=https://quote-api.jup.ag/v6
export RAYDIUM_API_URL=https://api-v3.raydium.io
export UNISWAP_API_URL=https://api.uniswap.org/v2

# ── Service → Port mapping ──────────────────────────────────────────────
#               service directory            port
SERVICES=(
  "apps/operator-api                         3100"
  "services/execution-tracker                3101"
  "services/relayer-monitor                  3102"
  "services/venue-health-monitor             3103"
  "services/market-health-monitor            3104"
  "services/synthetic-risk-monitor           3105"
  "services/alert-engine                     3106"
  "services/protocol-control                 3107"
  "services/relayer-service                  3215"
  "services/synthetic-service                3220"
  "services/market-data-service              3210"
  "services/quote-engine                     3211"
  "services/router-service                   3212"
  "services/execution-service                3213"
  "apps/relayer-api                          3200"
  "services/execution-worker                 3201"
  "services/inventory-manager                3202"
  "services/hedging-engine                   3203"
  "services/reconciliation-service           3204"
  "services/quote-refresher                  3205"
  "services/escrow-service                   3300"
  "apps/escrow-api                           3301"
  "services/risk-monitor-service             3310"
  "services/inventory-rebalancer             3320"
  "services/redemption-service               3330"
)

# ── Stop command ────────────────────────────────────────────────────────
if [[ "${1:-}" == "stop" ]]; then
  echo "Stopping all dev services..."
  if [[ -f "$PID_FILE" ]]; then
    while IFS= read -r pid; do
      kill "$pid" 2>/dev/null && echo "  Stopped PID $pid" || true
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
  echo "All services stopped."
  exit 0
fi

# ── Pre-flight checks ──────────────────────────────────────────────────
echo "=== DCC Synthetic Liquidity Engine — Local Dev ==="
echo ""

# Check Postgres
if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1 && ! /opt/homebrew/opt/postgresql@16/bin/pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
  echo "ERROR: PostgreSQL is not running on localhost:5432"
  echo "  Start it with: brew services start postgresql@16"
  exit 1
fi
echo "✓ PostgreSQL running on :5432"

# Check Redis
if ! redis-cli ping >/dev/null 2>&1; then
  echo "ERROR: Redis is not running on localhost:6379"
  echo "  Start it with: brew services start redis"
  exit 1
fi
echo "✓ Redis running on :6379"

# Check build
if [[ ! -d "$ROOT_DIR/packages/types/dist" ]]; then
  echo "→ Building packages (first time)..."
  cd "$ROOT_DIR" && pnpm run build
fi
echo "✓ Packages built"
echo ""

# ── Start services ──────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"
rm -f "$PID_FILE"

echo "Starting backend services..."
for entry in "${SERVICES[@]}"; do
  dir=$(echo "$entry" | awk '{print $1}')
  port=$(echo "$entry" | awk '{print $2}')
  name=$(basename "$dir")
  service_dir="$ROOT_DIR/$dir"

  if [[ ! -f "$service_dir/package.json" ]]; then
    continue
  fi

  # Find tsx in the service's node_modules, fall back to a known location
  local_tsx="$service_dir/node_modules/.bin/tsx"
  if [[ ! -x "$local_tsx" ]]; then
    local_tsx="$ROOT_DIR/services/market-data-service/node_modules/.bin/tsx"
  fi

  (cd "$service_dir" && PORT=$port HOST=0.0.0.0 "$local_tsx" src/index.ts) \
    > "$LOG_DIR/$name.log" 2>&1 &
  pid=$!
  echo "$pid" >> "$PID_FILE"
  printf "  %-30s → localhost:%-5s (PID %s)\n" "$name" "$port" "$pid"
done

echo ""
echo "Starting web frontend..."
cd "$ROOT_DIR/apps/web"
./node_modules/.bin/vite --port 5173 --host > "$LOG_DIR/web.log" 2>&1 &
web_pid=$!
echo "$web_pid" >> "$PID_FILE"
printf "  %-30s → localhost:%-5s (PID %s)\n" "web (vite)" "5173" "$web_pid"

echo ""
echo "=== All services started ==="
echo ""
echo "  Frontend:        http://localhost:5173"
echo "  Admin Dashboard: http://localhost:5173/admin"
echo "  Operator API:    http://localhost:3100"
echo "  Market Data:     http://localhost:3210"
echo "  Quote Engine:    http://localhost:3211"
echo "  Router Service:  http://localhost:3212"
echo "  Execution:       http://localhost:3213"
echo ""
echo "  Logs:  $LOG_DIR/"
echo "  Stop:  ./scripts/dev-local.sh stop"
echo ""
echo "Press Ctrl+C to stop all services"

# ── Trap shutdown ───────────────────────────────────────────────────────
cleanup() {
  echo ""
  echo "Shutting down..."
  if [[ -f "$PID_FILE" ]]; then
    while IFS= read -r pid; do
      kill "$pid" 2>/dev/null || true
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
  echo "All services stopped."
  exit 0
}
trap cleanup SIGINT SIGTERM

# Wait for all background pids
wait
