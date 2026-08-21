#!/usr/bin/env bash
# Proves compose.replica.yaml's streaming replica is real: a row written on the primary lands
# on the replica within a few seconds, and killing the replica doesn't take the primary with it.
# This is the DB layer only — adminRead()'s failover/lag logic is unit-tested against a mocked
# client in backend/src/lib/read-replica.test.ts, because that logic doesn't need a live
# database to prove, only the replication itself does.
#
# Usage: ci/verify-read-replica.sh
# Exit 0 = replication proven + replica survives being killed without taking the primary down.
# Exit 1 = a step failed; see the labelled section that printed last.
#
# Leaves db/db-replica running on exit (tear down yourself: `docker compose -f compose.yaml
# -f compose.replica.yaml down -v`) so a failure can be poked at instead of vanishing.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

COMPOSE="docker compose -f compose.yaml -f compose.replica.yaml"
MARKER_TABLE="_replica_verify"
LAG_TIMEOUT_S=20

echo "== up: db + db-replica =="
$COMPOSE up -d db
echo "waiting for db to report healthy..."
for _ in $(seq 1 30); do
  status="$($COMPOSE ps --format '{{.Health}}' db 2>/dev/null || true)"
  [ "$status" = "healthy" ] && break
  sleep 2
done
[ "$status" = "healthy" ] || { echo "FAIL: db never became healthy"; exit 1; }

# Idempotent, and deliberately not left to docker-entrypoint-initdb.d alone: that only runs
# against an EMPTY data directory, so a `db` volume from before this overlay existed (any
# ordinary `docker compose up -d` run) silently skips db/replica-role.sh and this environment
# never gets a replication role or the pg_hba line it needs. Applying both here, every run,
# is what makes the script work against a laptop that already has pgdata populated.
echo "== ensuring the replication role + pg_hba entry exist on the primary =="
$COMPOSE exec -T db psql -U interviewly -d interviewly -v ON_ERROR_STOP=1 <<-'EOSQL'
	DO $$
	BEGIN
	  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'replicator') THEN
	    CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'replicator';
	  END IF;
	END
	$$;
EOSQL
$COMPOSE exec -T db sh -c \
  'grep -q "^host replication replicator" "$PGDATA/pg_hba.conf" || \
   echo "host replication replicator all scram-sha-256" >> "$PGDATA/pg_hba.conf"'
$COMPOSE exec -T db psql -U interviewly -d interviewly -c 'SELECT pg_reload_conf();' >/dev/null

$COMPOSE up -d db-replica

echo "== waiting for db-replica to report healthy =="
for _ in $(seq 1 30); do
  status="$($COMPOSE ps --format '{{.Health}}' db-replica 2>/dev/null || true)"
  [ "$status" = "healthy" ] && break
  sleep 2
done
[ "$status" = "healthy" ] || { echo "FAIL: db-replica never became healthy"; exit 1; }
echo "db and db-replica are healthy."

echo "== writing a marker row on the primary =="
marker="verify-$(date +%s)"
$COMPOSE exec -T db psql -U interviewly -d interviewly -c \
  "CREATE TABLE IF NOT EXISTS ${MARKER_TABLE} (value text);
   INSERT INTO ${MARKER_TABLE} (value) VALUES ('${marker}');" >/dev/null

echo "== polling the replica for it (up to ${LAG_TIMEOUT_S}s) =="
seen=""
for i in $(seq 1 "$LAG_TIMEOUT_S"); do
  seen="$($COMPOSE exec -T db-replica psql -U interviewly -d interviewly -tAc \
    "SELECT value FROM ${MARKER_TABLE} WHERE value = '${marker}';" 2>/dev/null || true)"
  [ "$seen" = "$marker" ] && { echo "Marker visible on replica after ${i}s."; break; }
  sleep 1
done
[ "$seen" = "$marker" ] || { echo "FAIL: marker never reached the replica"; exit 1; }

echo "== confirming the replica is actually in standby mode, not a second primary =="
in_recovery="$($COMPOSE exec -T db-replica psql -U interviewly -d interviewly -tAc \
  'SELECT pg_is_in_recovery();')"
[ "$(echo "$in_recovery" | tr -d '[:space:]')" = "t" ] || {
  echo "FAIL: db-replica is not in recovery mode — it isn't a standby"; exit 1;
}

echo "== killing db-replica and confirming the primary is unaffected =="
$COMPOSE stop db-replica >/dev/null
still_up="$($COMPOSE exec -T db pg_isready -U interviewly | grep -c 'accepting connections' || true)"
[ "$still_up" = "1" ] || { echo "FAIL: primary went down with the replica"; exit 1; }

echo "== ALL CHECKS PASSED: streaming replication + independent failure confirmed =="
