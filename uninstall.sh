#!/usr/bin/env bash
# Remove the workspace studio bundle from a DeepSeek Harness Web profile.
# Usage: bash ./uninstall.sh [profile]
# Env:   PROFILE  default profile when no positional argument is supplied
#        DSH_BIN  optional dsh executable path/name without extra arguments
set -euo pipefail

PROFILE="${1:-${PROFILE:-web}}"
BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_ROOT="$(cd "$BUNDLE_DIR/../.." && pwd)"
PACKAGE_NAME="@yishengjun8/dsh-workspace-studio"

DSH_HOME_RAW="${DSH_HOME:-$HOME/.dsh}"
if command -v cygpath >/dev/null 2>&1; then
  DSH_HOME_SHELL="$(cygpath -u "$DSH_HOME_RAW")"
else
  DSH_HOME_SHELL="$DSH_HOME_RAW"
fi
PROFILE_MANIFEST="$DSH_HOME_SHELL/profiles/$PROFILE/package.json"

installed=false
if [[ -f "$PROFILE_MANIFEST" ]]; then
  if node -e "const fs=require('node:fs'); const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.exit(Object.hasOwn(m.dependencies ?? {}, process.argv[2]) ? 0 : 1)" "$PROFILE_MANIFEST" "$PACKAGE_NAME"; then
    installed=true
  fi
fi

if [[ "$installed" == true ]]; then
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
  echo "==> removing $PACKAGE_NAME from profile '$PROFILE'"
  "${DSH_COMMAND[@]}" plugin --profile "$PROFILE" remove "$PACKAGE_NAME"
else
  echo "==> $PACKAGE_NAME is not installed in profile '$PROFILE'; nothing to remove"
fi

echo
if [[ -f "$PROFILE_MANIFEST" ]]; then
  echo "==> profile $PROFILE bundle layers:"
  node -e "const fs=require('node:fs'); const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); console.log((m.dsh?.profile?.bundles ?? []).join('\\n') || '(none)')" "$PROFILE_MANIFEST"
fi

echo
echo "Uninstalled. Restart the existing DeepSeek Harness Web process, then refresh the page."
echo "The shipped ui-layout will be restored after restart. No tests were run."
echo

read -r -p "Press Enter to exit..." || true