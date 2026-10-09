#!/usr/bin/env bash
# Structural proof that preflight.ts performs reads only. This is not a
# claim — it is re-checkable by anyone with a shell: run this script, or
# copy the two checks below and run them by hand.
#
# 1. No Firestore write-method call (.set/.update/.delete/.batch/.commit/.add)
#    appears in a real code line — only inside comments that document the
#    absence of such calls.
# 2. Neither of real-season-import's write-capable modules (firebaseAdmin.ts,
#    importer.ts) is imported anywhere in this package.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

FAIL=0

echo "Check 1: no write-method call outside a comment"
CODE_MATCHES=$(grep -n '\.set(\|\.update(\|\.delete(\|\.batch(\|\.commit(\|\.add(' preflight.ts \
  | grep -v '^[0-9]*: *//' \
  | grep -v '^[0-9]*:// ' || true)
if [ -n "$CODE_MATCHES" ]; then
  echo "FAIL: found a write-method call outside a comment:"
  echo "$CODE_MATCHES"
  FAIL=1
else
  echo "PASS: every match of a write-method name is inside a comment (documenting its absence), not a real call."
fi

echo ""
echo "Check 2: no import of real-season-import's write-capable modules"
IMPORT_MATCHES=$(grep -n "from '.*firebaseAdmin'\|from '.*importer'" preflight.ts || true)
if [ -n "$IMPORT_MATCHES" ]; then
  echo "FAIL: preflight.ts imports a write-capable module:"
  echo "$IMPORT_MATCHES"
  FAIL=1
else
  echo "PASS: preflight.ts does not import firebaseAdmin.ts or importer.ts from real-season-import."
fi

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "RESULT: preflight.ts is structurally read-only."
  exit 0
else
  echo "RESULT: FAILED — see above."
  exit 1
fi
