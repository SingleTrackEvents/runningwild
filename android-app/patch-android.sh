#!/usr/bin/env bash
# After `npx cap add android`: the Running Wild icon, and the name of the background location notification channel.
# Needs ImageMagick (convert), which the GitHub Actions Ubuntu runner has.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$HERE")"; RES="$HERE/android/app/src/main/res"
for pair in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  d="${pair%%:*}"; n="${pair##*:}"
  mkdir -p "$RES/mipmap-$d"
  convert "$ROOT/icons/icon-512.png" -resize "${n}x${n}" "$RES/mipmap-$d/ic_launcher.png"
  cp "$RES/mipmap-$d/ic_launcher.png" "$RES/mipmap-$d/ic_launcher_round.png"
  rm -f "$RES/mipmap-$d/ic_launcher_foreground.png"
done
# Plain icons, not the adaptive Capacitor ones.
rm -f "$RES/mipmap-anydpi-v26/ic_launcher.xml" "$RES/mipmap-anydpi-v26/ic_launcher_round.xml"
# The notification channel's name (shown when you press and hold the notification).
python3 - "$RES/values/strings.xml" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
if 'capacitor_background_geolocation_notification_channel_name' not in s:
    s = s.replace('</resources>', '    <string name="capacitor_background_geolocation_notification_channel_name">Sharing with Race Control</string>\n</resources>')
open(p, 'w').write(s)
PY
echo "patched icons and strings"
