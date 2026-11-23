// Running Wild Field, Android app only (android-app/build-www.sh puts this first in field.html).
// The tracking test: the phone keeps sending its position to Race Control with the screen off, through the
// background location plugin (@capacitor-community/background-geolocation), which runs a foreground service with
// a notification while it's on. Fixes go through the field app's own path (GPTField.gps), so the queue, the
// one-a-minute limit and the Worker's track are the same as the web app's; they're marked app 'apk' and, when
// the screen is off, background.
(function () {
  window.RW_APK = true;
  const plugins = () => (window.Capacitor && Capacitor.Plugins) || {};

  // Battery from Android itself (the WebView doesn't always give it to the page).
  window.RW_BATTERY = async () => {
    const D = plugins().Device;
    if (!D) return {};
    const b = await D.getBatteryInfo();
    return b && b.batteryLevel != null ? { bat: Math.round(b.batteryLevel * 100) / 100, charging: !!b.isCharging } : {};
  };

  let watcher = null, note = '', lastFix = 0;
  function say(t) {
    note = t;
    let el = document.getElementById('rwApkNote');
    const home = document.getElementById('fdTrack');
    if (!el && home && home.parentNode) { el = document.createElement('p'); el.id = 'rwApkNote'; el.className = 'fd-hint'; home.parentNode.insertBefore(el, home.nextSibling); }
    if (el) el.textContent = 'Android app: ' + note;
  }

  async function start() {
    const P = plugins(), BG = P.BackgroundGeolocation;
    if (watcher || !BG) { if (!BG) say('background location isn\'t available in this build.'); return; }
    // Android 13 and later only show the "sharing your location" notification with this permission.
    try { if (P.LocalNotifications) await P.LocalNotifications.requestPermissions(); } catch (e) { }
    try {
      watcher = await BG.addWatcher({
        backgroundTitle: 'Running Wild Field',
        backgroundMessage: 'Sharing your location with Race Control. Stop sharing in the app to turn this off.',
        requestPermissions: true,
        stale: false,
        distanceFilter: 0
      }, (loc, err) => {
        if (err) {
          if (err.code === 'NOT_AUTHORIZED') {
            say('location is off for this app. Allow it in Settings (Location, Allow all the time if offered).');
            if (confirm('Running Wild Field needs your location to share it with Race Control. Open Settings now?')) BG.openSettings();
          } else say('location error: ' + (err.message || err.code));
          return;
        }
        if (!loc) return;
        lastFix = Date.now();
        say('sharing with the screen off too. Last fix ' + new Date(loc.time || Date.now()).toLocaleTimeString('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) + '.');
        if (window.GPTField && GPTField.gps) GPTField.gps({
          coords: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy, altitude: loc.altitude, speed: loc.speed, heading: loc.bearing },
          timestamp: loc.time || Date.now()
        });
      });
      say('starting background location...');
    } catch (e) { watcher = null; say('couldn\'t start background location: ' + e.message); }
  }
  async function stop() {
    const BG = plugins().BackgroundGeolocation;
    if (watcher != null && BG) { try { await BG.removeWatcher({ id: watcher }); } catch (e) { } }
    watcher = null; say('not sharing, so background location is off.');
  }
  // Follow the field app's "Show me on the Control map": on when sharing, off when not.
  // (GPTLive tells on every status change, so act only when sharing is switched on or off.)
  let want = null;
  function sync() { const L = window.GPTLive; if (!L) return; const on = !!L.field.cfg().on; if (on === want) return; want = on; (on ? start : stop)(); }
  addEventListener('load', () => { sync(); if (window.GPTLive) GPTLive.onChange(sync); });
  // With the screen off the page may not be drawn, but queued fixes still go: the share path flushes on each fix.
  // On return, send anything left.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && window.GPTLive) GPTLive.field.flush(); });
})();
