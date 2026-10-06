#!/usr/bin/env bash
# Static proof that this diagnostic performs zero writes: greps every
# .ts file in this package for a Firestore/Auth write-method call. Any
# match fails the job before a credential is ever touched.
set -euo pipefail
cd "$(dirname "$0")"

FORBIDDEN='\.(set|update|delete|add|commit|batch)\(|createUser\(|updateUser\(|deleteUser\(|setCustomUserClaims\('

echo "Checking for forbidden write-method calls…"
if grep -rnE "$FORBIDDEN" --include='*.ts' diagnostic.ts src; then
  echo ""
  echo "FAILED: found a write-method call above. This script must never write anything."
  exit 1
fi
echo "OK: no write-method call found in diagnostic.ts or src/."
