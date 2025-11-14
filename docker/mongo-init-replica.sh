#!/bin/bash
set -euo pipefail

export PATH="/usr/bin:/bin:/usr/local/bin:$PATH"

echo "[mongo-init-replica] Waiting for Mongo replica set to become PRIMARY..."

while true; do
  set +e
  mongosh --host mongo:27017 --quiet <<'EOS'
try {
  const status = rs.status();
  if (status.ok === 1 && status.members) {
    const primary = status.members.find(member => member.stateStr === 'PRIMARY');
    if (primary) {
      quit(0);
    }
  }
} catch (error) {
  if (error.codeName === 'NotYetInitialized' || (error.message && error.message.includes('not yet initialized'))) {
    rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'mongo:27017'}]});
  } else {
    throw error;
  }
}
quit(1);
EOS
  exit_code=$?
  set -e
  if [ "$exit_code" -eq 0 ]; then
    echo "[mongo-init-replica] Replica set PRIMARY detected."
    break
  fi
  echo "[mongo-init-replica] Replica set not ready yet, retrying in 2s..."
  sleep 2
done
