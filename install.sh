#!/usr/bin/env bash
# Install the workspace studio bundle into a DeepSeek Harness Web profile.
# Usage: bash ./install.sh [--git] [profile]
#   --git     install directly from the plugin git remote
#             (github:<owner>/<repo>#<commit>) instead of the local checkout.
#             pnpm >= 10 blocks the install-time prepare build until the package
#             is allowlisted; the script parses pnpm's printed key and adds it to
#             the profile's pnpm-workspace.yaml, then retries the add.
# Env:   PROFILE   default profile when no positional argument is supplied
#        GIT_SPEC  git dependency spec to use with --git (default: this repo's origin)
#        DSH_BIN   optional dsh executable path/name without extra arguments
set -euo pipefail

GIT_MODE=0
POSITIONAL=()
for arg in "$@"; do
  if [[ "$arg" == "--git" ]]; then
    GIT_MODE=1
  else
    POSITIONAL+=("$arg")
  fi
done

if [[ ${#POSITIONAL[@]} -gt 0 ]]; then
  PROFILE="${POSITIONAL[0]}"
else
  PROFILE="${PROFILE:-web}"
fi
BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_ROOT="$(cd "$BUNDLE_DIR/../.." && pwd)"

if command -v cygpath >/dev/null 2>&1; then
  BUNDLE_NATIVE="$(cygpath -m "$BUNDLE_DIR")"
else
  BUNDLE_NATIVE="$BUNDLE_DIR"
fi
BUNDLE_SPEC="file:$BUNDLE_NATIVE"
PACKAGE_NAME="@deepseek-ai/dsh-workspace-studio"

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
PROFILE_DIR="$DSH_HOME_SHELL/profiles/$PROFILE"

# Add one exact pnpm allowBuilds key (name@spec#commit) to the profile's
# pnpm-workspace.yaml so a git dependency's prepare script may run at install
# time. The key comes verbatim from pnpm's printed hint.
ensure_allowbuilds() {
  local key="$1"
  mkdir -p "$PROFILE_DIR"
  WS_KEY="$key" node -e '
    const fs = require("node:fs");
    const [p] = process.argv.slice(1);
    const key = process.env.WS_KEY;
    let t = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
    if (/^allowBuilds:/m.test(t)) {
      if (!t.includes(key)) {
        t = t.replace(/^allowBuilds:/m, "allowBuilds:\n  \"" + key + "\": true");
        fs.writeFileSync(p, t);
      }
    } else {
      if (t.trimEnd()) t = t.trimEnd() + "\n\n";
      t += "allowBuilds:\n  \"" + key + "\": true\n";
      fs.writeFileSync(p, t);
    }
  ' "$PROFILE_DIR/pnpm-workspace.yaml"
}

if [[ "$GIT_MODE" == 1 ]]; then
  # Resolve the git spec: an explicit GIT_SPEC wins verbatim; otherwise derive
  # it from this repo's origin remote (falling back to the canonical GitHub
  # repo) and pin the install to the current HEAD so a later push cannot
  # silently change what runs.
  if [[ -z "${GIT_SPEC:-}" ]]; then
    REMOTE_URL="$(git -C "$BUNDLE_DIR" remote get-url origin 2>/dev/null || true)"
    if [[ "$REMOTE_URL" =~ ^(https?://github\.com/|git@github\.com:)([^/]+)/([^/.]+)(\.git)?$ ]]; then
      GIT_SPEC="github:${BASH_REMATCH[2]}/${BASH_REMATCH[3]}"
    else
      GIT_SPEC="github:yishengjun8/dsh-workspace-studio"
    fi
    HEAD_SHA="$(git -C "$BUNDLE_DIR" rev-parse HEAD 2>/dev/null || true)"
    if [[ -n "$HEAD_SHA" ]]; then
      if [[ -n "$(git -C "$BUNDLE_DIR" status --porcelain 2>/dev/null || true)" ]]; then
        echo "warning: working tree has uncommitted changes; installing the committed HEAD $HEAD_SHA" >&2
      fi
      GIT_SPEC="${GIT_SPEC}#${HEAD_SHA}"
    else
      echo "warning: could not resolve HEAD; installing unpinned $GIT_SPEC" >&2
    fi
  fi

  echo "==> adding $PACKAGE_NAME to profile '$PROFILE' (from git: $GIT_SPEC)"
  set +e
  ADD_OUTPUT="$("${DSH_COMMAND[@]}" plugin --profile "$PROFILE" add "$GIT_SPEC" 2>&1)"
  ADD_STATUS=$?
  set -e
  if [[ $ADD_STATUS -eq 0 ]]; then
    printf '%s\n' "$ADD_OUTPUT"
  else
    ALLOW_KEY="$(printf '%s\n' "$ADD_OUTPUT" | grep -oE '^[[:space:]]*[^[:space:]]+@[^[:space:]]+[[:space:]]*: true' | sed 's/^[[:space:]]*//; s/[[:space:]]*: true$//' | head -n1)"
    if [[ -z "$ALLOW_KEY" ]]; then
      printf '%s\n' "$ADD_OUTPUT" >&2
      echo "error: git install failed and no allowBuilds hint was found" >&2
      exit 1
    fi
    echo "==> pnpm >= 10 blocked the install-time build"
    echo "    allowlisting '$ALLOW_KEY' (runs the package's prepare script on this machine at install time)"
    ensure_allowbuilds "$ALLOW_KEY"
    "${DSH_COMMAND[@]}" plugin --profile "$PROFILE" add "$GIT_SPEC"
  fi
else
  echo "==> adding $PACKAGE_NAME to profile '$PROFILE' (local checkout)"
  "${DSH_COMMAND[@]}" plugin --profile "$PROFILE" add "$BUNDLE_SPEC"
fi

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
