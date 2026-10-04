#!/usr/bin/env bash
# Stamps app.js and each worklet reference with a content-hash query string
# (?v=<sha256 prefix>), so GitHub Pages' CDN cache busts exactly when a
# file's content changes — not on every deploy, the way a plain timestamp
# would. Re-running is safe: a file whose content hasn't changed gets
# restamped with the same hash.
#
# Run manually after editing app.js or a worklet, before committing. Or
# install the pre-commit hook (see CLAUDE.md "Cache-busting") to have this
# run automatically.
#
# New effect/worklet added? Add a matching `restamp` line below — this list
# is intentionally explicit, not a glob, to match EFFECTS in app.js.
#
# Uses BSD sed (`sed -i ''`), matching this project's macOS dev environment.
set -euo pipefail
cd "$(dirname "$0")"

hash_of() { shasum -a 256 "$1" | cut -c1-10; }

# Rewrites the ?v=<hash> on the first "<path>[?v=...]" occurrence in $2.
restamp() {
  local path="$1" target="$2" hash escaped
  hash=$(hash_of "$path")
  escaped="${path//./\\.}"
  sed -i '' -E "s#(${escaped})(\\?v=[0-9a-f]+)?\"#\\1?v=${hash}\"#" "$target"
  echo "$path -> ?v=${hash}"
}

restamp "worklets/reversed-fricatives-processor.js" app.js
restamp "worklets/spooky-voice-processor.js" app.js

restamp "app.js" index.html
