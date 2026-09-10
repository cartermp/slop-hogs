#!/bin/sh
set -eu
node scripts/check-cost-policy.ts
node scripts/migrate.ts
node scripts/check-database.ts
exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port "${PORT:-3000}"
