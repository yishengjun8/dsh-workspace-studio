#!/usr/bin/env bash
# Install the workspace studio bundle into a DeepSeek Harness Web profile.
# Usage: bash ./install.sh [--git] [profile]
#   --git     install directly from the plugin git remote
#             (github:<owner>/<repo>#<commit>) instead of the local checkout.
#             The repository ships the built lib/ artifacts and declares no
#             install-time build script, so pnpm needs no allowlist entry.
#             The recovery below stays as a safety net: an older commit (or one
#             that reintroduces a build script) makes pnpm >= 10 block the
#             install until the package is allowlisted, and the script then
#             parses pnpm's printed key, adds it to the profile's
#             pnpm-workspace.yaml, and retries the add.
#   profile   default 'web'. 'desktop' is the Electron application's reserved
#             profile: it only works when the 'dsh' on PATH is the Desktop
#             command (Desktop app -> 'Manage dsh Command...' -> Install),
#             because a registry installation refuses that profile name.
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
# The Desktop profile is owned by the Electron application: only its own bundled CLI
# carries the reserved-profile grant, so a registry dsh refuses it. Detect that case
# and point at the two supported routes instead of leaking the harness wording.
IS_DESKTOP_PROFILE=0
if [[ "$(printf '%s' "$PROFILE" | tr '[:upper:]' '[:lower:]')" == "desktop" ]]; then
  IS_DESKTOP_PROFILE=1
fi
BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The bundle may live one level below the harness root (../) or two (../../);
# prefer the deeper path, fall back to the shallower one.
if [[ -f "$BUNDLE_DIR/../../package.json" ]]; then
  HARNESS_ROOT="$(cd "$BUNDLE_DIR/../.." && pwd)"
else
  HARNESS_ROOT="$(cd "$BUNDLE_DIR/.." && pwd)"
fi

if command -v cygpath >/dev/null 2>&1; then
  BUNDLE_NATIVE="$(cygpath -m "$BUNDLE_DIR")"
else
  BUNDLE_NATIVE="$BUNDLE_DIR"
fi
BUNDLE_SPEC="file:$BUNDLE_NATIVE"
PACKAGE_NAME="@yishengjun8/dsh-workspace-studio"

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

# Pre-flight the reserved profile: a bare 'plugin --profile desktop' performs no
# package work, and only a CLI without the Desktop grant rejects the name.
if [[ "$IS_DESKTOP_PROFILE" == 1 ]]; then
  PROBE_OUTPUT="$("${DSH_COMMAND[@]}" plugin --profile "$PROFILE" 2>&1 || true)"
  if [[ "$PROBE_OUTPUT" == *"managed exclusively by the Electron"* ]]; then
    echo "error: the 'dsh' this script found is a registry installation, and profile" >&2
    echo "       'desktop' is managed exclusively by the DeepSeek Harness desktop app." >&2
    echo "       Install the bundle one of these ways instead:" >&2
    echo "         1. Desktop app -> Plugins -> Add plugin, then restart the app" >&2
    echo "            (sources: github:yishengjun8/dsh-workspace-studio, a pinned" >&2
    echo "             github:<owner>/<repo>#<commit>, or an absolute local path)" >&2
    echo "         2. Desktop app -> 'Manage dsh Command...' -> Install, then re-run this" >&2
    echo "            script so the Desktop command is the 'dsh' on PATH" >&2
    exit 1
  fi
fi

DSH_HOME_RAW="${DSH_HOME:-$HOME/.dsh}"
if command -v cygpath >/dev/null 2>&1; then
  DSH_HOME_SHELL="$(cygpath -u "$DSH_HOME_RAW")"
else
  DSH_HOME_SHELL="$DSH_HOME_RAW"
fi
PROFILE_MANIFEST="$DSH_HOME_SHELL/profiles/$PROFILE/package.json"
PROFILE_DIR="$DSH_HOME_SHELL/profiles/$PROFILE"

# Allowlist the pnpm allowBuilds key (name@spec#commit) printed by pnpm so a
# git dependency's build script may run at install time. Only reached for a
# fetched version that still declares one.
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
  # it from this repo's origin remote and pin to the current HEAD so a later
  # push cannot silently change what runs.
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
    echo "==> pnpm >= 10 blocked the install-time build of this fetched version"
    echo "    allowlisting '$ALLOW_KEY' (runs that version's build script on this machine at install time)"
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
if [[ "$IS_DESKTOP_PROFILE" == 1 ]]; then
  echo "Installed into the Desktop profile ($PROFILE_DIR)."
  echo "Quit and reopen the DeepSeek Harness desktop app so its Host composes the profile again;"
  echo "the Desktop profile is a separate copy, so the Web profile keeps its own installed copy."
else
  echo "Installed. Restart the existing DeepSeek Harness Web process, then refresh the page."
fi
echo "The script did not start another server and did not run tests."
echo

read -r -p "Press Enter to exit..." || true
