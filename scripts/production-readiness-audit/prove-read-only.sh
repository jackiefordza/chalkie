#!/usr/bin/env bash
# Static proof this script cannot write anything, run as its own workflow
# step BEFORE any Firebase credential is ever touched. Mirrors
# scripts/production-preflight/prove-read-only.sh's exact convention
# (that PR's own README calls this out as the established pattern for a
# script that's safe to point at production).
set -euo pipefail

cd "$(dirname "$0")"

WRITE_PATTERN='\.(set|update|delete|add)\(|\.batch\(|\.commit\(|createUser\(|updateUser\(|deleteUser\(|setCustomUserClaims\('

echo "Checking src/ and audit.ts for any write-capable call…"
if grep -rnE "$WRITE_PATTERN" src/ audit.ts --include='*.ts'; then
  echo ""
  echo "REFUSING TO PROCEED: found a write-capable call above. This script must never write to"
  echo "chalkie-app (or any Firebase project) — aborting before any credential is touched."
  exit 1
fi

echo "No write-capable call found. Safe to proceed."
