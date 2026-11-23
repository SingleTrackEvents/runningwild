#!/usr/bin/env bash
# After `npx cap add android`: the Running Wild icon, and the name of the background location notification channel.
# The icons are made once from icons/icon-512.png into android-app/icons (no image tools needed on the build machine).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; RES="$HERE/android/app/src/main/res"
for d in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  mkdir -p "$RES/mipmap-$d"
  cp "$HERE/icons/mipmap-$d/ic_launcher.png" "$RES/mipmap-$d/ic_launcher.png"
  cp "$HERE/icons/mipmap-$d/ic_launcher.png" "$RES/mipmap-$d/ic_launcher_round.png"
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
