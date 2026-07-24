#!/bin/sh
# Render every store capture to a 1280x800 PNG beside its source.
#
#   sh store-assets/render.sh            # all of them
#   sh store-assets/render.sh 4          # just screenshot-4-*.html
#
# Chrome is used headless rather than a screenshot tool so the result is identical on any
# machine: same viewport, same device scale, no window chrome, no retina doubling.
set -eu

DIR=$(cd "$(dirname "$0")" && pwd)
CHROME=${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}
[ -x "$CHROME" ] || { echo "Chrome not found — set CHROME=/path/to/chrome" >&2; exit 1; }

WHICH=${1:-}
for src in "$DIR"/screenshot-${WHICH:-[0-9]}*.html; do
  out=${src%.html}.png
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size=1280,800 \
    --screenshot="$out" "file://$src" >/dev/null 2>&1
  echo "$(basename "$out")"
done
