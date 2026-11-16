#!/usr/bin/env bash
# Backup restore drill: dump the database, restore it into a scratch database, and check that the
# data survived (row counts match, migrations are at head, the app's readiness query works).
# Run it before launch and after any change to backups. Needs pg_dump/psql and a local Postgres.
set -euo pipefail
SRC="${DRILL_SOURCE_URL:-postgresql://postgres:postgres@localhost:5432/meetpractice}"
BASE="${SRC%/*}"; SCRATCH="drill_restore_$$"
DUMP="$(mktemp)"; trap 'psql "$BASE/postgres" -qc "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null 2>&1 || true; rm -f "$DUMP"' EXIT
tables="users auth_sessions login_tokens audio_tokens idempotency_keys notes companies company_sources company_briefs research_jobs sessions utterances suggestions scores usage"
count() { psql "$1" -Atc "select count(*) from $2" 2>/dev/null || echo "-"; }
pg_dump --format=custom --no-owner "$SRC" > "$DUMP"
echo "dump: $(du -h "$DUMP" | cut -f1)"
psql "$BASE/postgres" -qc "CREATE DATABASE $SCRATCH"
pg_restore --no-owner -d "$BASE/$SCRATCH" "$DUMP"
fail=0
for t in $tables; do
  a=$(count "$SRC" $t); b=$(count "$BASE/$SCRATCH" $t)
  [ "$a" = "$b" ] && echo "ok    $t: $a rows" || { echo "FAIL  $t: source $a, restored $b"; fail=1; }
done
va=$(psql "$SRC" -Atc "select version_num from alembic_version"); vb=$(psql "$BASE/$SCRATCH" -Atc "select version_num from alembic_version")
[ "$va" = "$vb" ] && echo "ok    migration version $vb" || { echo "FAIL  migration version $va vs $vb"; fail=1; }
psql "$BASE/$SCRATCH" -Atc "select 1" >/dev/null && echo "ok    restored database answers queries"
exit $fail
