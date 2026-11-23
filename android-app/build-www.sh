#!/usr/bin/env bash
# Gather the field app's files into android-app/www for the Android app (Capacitor serves them from the phone).
# Run from anywhere: bash android-app/build-www.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$HERE")"; WWW="$HERE/www"
rm -rf "$WWW"; mkdir -p "$WWW"
cp "$ROOT/field.html" "$ROOT/manifest-field.webmanifest" "$HERE/apk.js" "$WWW/"
for d in css js lib icons data tiles; do cp -r "$ROOT/$d" "$WWW/"; done
# The app opens on the field app.
printf '<!DOCTYPE html><meta charset="utf-8"><title>Running Wild Field</title><script>location.replace("field.html" + location.search + location.hash)</script>\n' > "$WWW/index.html"
# apk.js first, so the field app knows it's in the Android app before anything else runs.
python3 - "$WWW/field.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
assert '<head>' in s
s = s.replace('<head>', '<head>\n<script src="apk.js"></script>', 1)
open(p, 'w').write(s)
PY
echo "www: $(find "$WWW" -type f | wc -l) files, $(du -sh "$WWW" | cut -f1)"
