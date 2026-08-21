#!/bin/sh
# db-replica's entrypoint (compose.replica.yaml). On an empty data directory it clones the
# primary with pg_basebackup, which (via -R) writes standby.signal + primary_conninfo for us —
# that's what makes the clone come up in streaming-standby mode instead of as a second primary.
# A populated data directory (a restart, not a first boot) skips straight to the normal image
# entrypoint; re-cloning a standby that already has one is not this script's job.
set -e

if [ -z "$(ls -A "$PGDATA" 2>/dev/null)" ]; then
  echo "db-replica: empty data dir, cloning from primary..."
  until PGPASSWORD=replicator pg_basebackup -h db -U replicator -D "$PGDATA" -Fp -Xs -P -R; do
    echo "db-replica: primary not ready yet, retrying in 2s..."
    sleep 2
  done
  chmod 0700 "$PGDATA"
fi

exec docker-entrypoint.sh postgres
