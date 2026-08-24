#!/usr/bin/env bash
# Install the workspace studio bundle into a DeepSeek Harness Web profile.
# Usage: bash ./install.sh [profile]
# Env:   PROFILE  default profile when no positional argument is supplied
#        DSH_BIN  optional dsh executable path/name without extra arguments
set -euo pipefail

PROFILE="${1:-${PROFILE:-web}}"
BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_ROOT="$(cd "$BUNDLE_DIR/../.." && pwd)"

if command -v cygpath >/dev/null 2>&1; then
  BUNDLE_NATIVE="$(cygpath -m "$BUNDLE_DIR")"
else
  BUNDLE_NATIVE="$BUNDLE_DIR"
fi
BUNDLE_SPEC="file:$BUNDLE_NATIVE"

if [[ -n "${DSH_BIN:-}" ]]; then
  DSH_COMMAND=("$DSH_BIN")
elif command -v dsh >/dev/null 2>&1; then
  DSH_COMMAND=(dsh)
elif command -v pnpm >/dev/null 2>&1 && [[ -f "$HARNESS_ROOT/package.json" ]]; then
  DSH_COMMAND=(pnpm --dir "$HARNESS_ROOT" dsh)
else
  echo "error: cannot find 'dsh'; install it on PATH or set DSH_BIN" >&2
  exit 1
fi

DSH_HOME_RAW="${DSH_HOME:-$HOME/.dsh}"
if command -v cygpath >/dev/null 2>&1; then
  DSH_HOME_SHELL="$(cygpath -u "$DSH_HOME_RAW")"
else
  DSH_HOME_SHELL="$DSH_HOME_RAW"
fi
PROFILE_MANIFEST="$DSH_HOME_SHELL/profiles/$PROFILE/package.json"

echo "==> adding @deepseek-ai/dsh-workspace-studio to profile '$PROFILE'"
"${DSH_COMMAND[@]}" plugin --profile "$PROFILE" add "$BUNDLE_SPEC"

echo
if [[ -f "$PROFILE_MANIFEST" ]]; then
  echo "==> profile $PROFILE bundle layers:"
  node -e "const fs=require('node:fs'); const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log((m.dsh?.profile?.bundles ?? []).join('\\n') || '(none)')" "$PROFILE_MANIFEST"
fi

echo
echo "Installed. Restart the existing DeepSeek Harness Web process, then refresh the page."
echo "The script did not start another server and did not run tests."
echo

read -r -p "Press Enter to exit..." || true
