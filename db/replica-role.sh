#!/bin/sh
# Runs once, on the primary's first init (docker-entrypoint-initdb.d), only when
# compose.replica.yaml is included — that file is what mounts this script onto `db`. Creates
# the replication role db-replica connects as, and opens pg_hba for it: the image's default
# pg_hba.conf covers normal client connections ("all" databases) but NOT the "replication"
# pseudo-database, which needs its own explicit line.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	DO \$\$
	BEGIN
	  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'replicator') THEN
	    CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'replicator';
	  END IF;
	END
	\$\$;
EOSQL

echo "host replication replicator all scram-sha-256" >> "$PGDATA/pg_hba.conf"
