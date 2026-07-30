#!/usr/bin/env bash
# Stand up the disposable Postgres harness for Phase 1/2 persistence cases: a throwaway
# container, migrations applied in filename order, nothing else. Re-run any time — it always
# starts from a clean, empty database (the container has no volume, so `down.sh` erases
# everything, and `up.sh` recreates from scratch).
#
# Usage: scripts/disposable-db/up.sh
# Then:  node --env-file=.env.local scripts/verify-phase1-db-cases.mjs disposable --confirm-disposable
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root

IMAGE="supabase/postgres:15.8.1.093"
NAME="cashford-disposable-db"
PORT="55432"

echo "== recreating $NAME =="
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" \
  -p "$PORT:5432" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=postgres \
  --tmpfs /var/lib/postgresql/data \
  "$IMAGE" >/dev/null

echo "== waiting for postgres =="
for _ in $(seq 1 30); do
  docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
sleep 2  # supabase/postgres restarts once mid-init; give the second boot a moment

export PGPASSWORD=postgres
PSQL="psql -h localhost -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"

echo "== applying schema.sql + rls_functions.sql (creates the auth.users trigger) =="
$PSQL -f supabase/migrations/20260618000001_schema.sql
$PSQL -f supabase/migrations/20260618000002_rls_functions.sql

echo "== bootstrapping the 'ananth' auth user (must exist before the accounts migration backfills leagues.created_by) =="
$PSQL -f scripts/disposable-db/00-bootstrap-auth.sql

echo "== applying remaining migrations in order =="
for f in supabase/migrations/*.sql; do
  case "$f" in
    *20260618000001_schema.sql|*20260618000002_rls_functions.sql) continue ;;
  esac
  echo "  -> $f"
  $PSQL -f "$f"
done

echo
echo "Harness ready: postgresql://postgres:postgres@localhost:$PORT/postgres"
echo "Run the disposable cases with:"
echo "  node --env-file=.env.local scripts/verify-phase1-db-cases.mjs disposable --confirm-disposable"
