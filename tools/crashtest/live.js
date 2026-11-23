// Crash test: the line to Race Control (js/live.js): notices, help requests, field phones on the board, fault reports,
// alerts, and the lighter updates for a long race.
//   node tools/crashtest/live.js demo      the board, the runner app and the field app in three tabs of one browser,
//                                          with the demo standing in for the Worker
//   node tools/crashtest/live.js worker    the phone apps against the Worker itself, run on this computer
//                                          (worker-local.mjs on :8787, which run.js starts). The board's side is done
//                                          through the Worker's own addresses, so no medical password is needed.
// Nothing here reaches the real Worker, the tracking or timing providers, or a phone alert service.
const { chromium, devices } = require('playwright');
const { launch, open, sleep, BASE, FEEDS } = require('./lib');
const API = process.env.WORKER || 'http://127.0.0.1:8787', PW = process.env.RC_PASSWORD || 'local-test', ORIGIN = BASE.replace(/\/$/, '');
const issues = [];
const check = (what, ok, got) => { console.log((ok ? '  ok   ' : '  FAIL ') + what + (ok || got === undefined ? '' : '  → ' + String(typeof got === 'string' ? got : JSON.stringify(got)).slice(0, 300))); if (!ok) issues.push(what + (got === undefined ? '' : ': ' + String(typeof got === 'string' ? got : JSON.stringify(got)).slice(0, 300))); };
const flat = s => String(s || '').replace(/\s+/g, ' ').trim();
const SEEN = { gptIntroSafety: '1', gptIntroMap: '1', gptIntroField: '1', 'rn.introDone': 'true', gpt100_rc_name: 'Test operator' };
const HALLS = { latitude: -37.14067, longitude: 142.51921, accuracy: 8 };
const quiet = x => /Service Worker|status of 4\d\d|ERR_FAILED|ERR_ABORTED|Failed to load resource|ERR_CONNECTION|ERR_INTERNET|ERR_NAME_NOT_RESOLVED/.test(x);
const text = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !e || e.hidden ? '' : e.innerText; }, sel);
const tap = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(700); } return false; };
const pageErrors = (name, log) => check(name + ': no errors on the page', !log.errors.length && !log.console.filter(c => /error:/.test(c) && !quiet(c)).length, log.errors.concat(log.console.filter(c => /error:/.test(c) && !quiet(c))).slice(0, 3));
// The board's side, through the Worker (as js/rc.js does it).
const rc = async (path, body) => { const r = await fetch(API + path, { method: body ? 'POST' : 'GET', headers: Object.assign({ Origin: ORIGIN, 'X-RC-Password': PW }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); return r.json().catch(() => ({})); };

// ---------------------------------------------------------------- demo: three tabs, no Worker
async function demo() {
  console.log('\n== demo: the board, the runner app and the field app in one browser ==');
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: 'Australia/Melbourne', locale: 'en-AU', serviceWorkers: 'block', geolocation: HALLS, permissions: ['geolocation'] });
  await ctx.addInitScript(s => { try { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); } catch (e) { } window.__xss = 0; window.alert = () => { window.__xss++; }; }, SEEN);
  let out = 0; await ctx.route(/workers\.dev/, r => { out++; r.abort(); }); await ctx.route(/what3words/, r => r.abort());
  const errs = [], mk = async (path, vp) => { const p = await ctx.newPage(); if (vp) await p.setViewportSize(vp); p.on('pageerror', e => errs.push(path + ': ' + String(e).slice(0, 300))); await p.goto(BASE + path, { waitUntil: 'load' }); return p; };
  const C = await mk('index.html?demo=1'); await sleep(3000);
  await tap(C, '.tab-btn[data-tab="rc"]'); await sleep(2500);
  check('the board has its Phones panel', /Notice to the phones/i.test(await text(C, '#rcLive')), (await text(C, '#rcLive')).slice(0, 120));
  await C.fill('#rcNoticeText', 'Hot soup at Halls Gap <img src=x onerror=alert(1)>'); await tap(C, '#rcNotice button[type=submit]'); await sleep(1500);
  const R = await mk('runner.html?demo=1', { width: 390, height: 760 }); await sleep(3500);
  check('a notice from the board shows in the runner app', /Hot soup at Halls Gap/.test(await text(R, '#gptNotices')), await text(R, '#gptNotices'));
  await R.evaluate(() => GPTRunner.setTab('help')); await sleep(600);
  check('the runner app offers Tell Race Control while the board is open', !!(await text(R, '#rnRc')));
  await R.fill('#rnRcBib', '1047'); await tap(R, 'input[name=rnRcWhat][value=lost]'); await tap(R, '#rnRcSend');
  check('the help request is sent', await until(async () => /Sent at/.test(await text(R, '#rnRcBody')), 9000), await text(R, '#rnRcBody'));
  check('it lands on the board, to be acknowledged', await until(async () => /I'm lost/.test(await text(C, '.rc-needsack')), 12000), await text(C, '.rc-needsack'));
  await tap(C, '.rc-needsack [data-act="ack"]');
  check('the runner\'s phone says Race Control has it', await until(async () => /Race Control has your message/.test(await text(R, '#rnRcBody')), 30000), await text(R, '#rnRcBody'));
  const F = await mk('field.html?demo=1', { width: 390, height: 760 }); await sleep(3500);
  await F.evaluate(() => GPTFieldTab('where')); await sleep(500);
  check('the field app offers to show on the Control map', !!(await text(F, '#fdShare')));
  await F.fill('#fdShareName', 'Demo sweep'); await F.fill('#fdShareCode', 'demo'); await tap(F, '#fdShareForm button');
  check('the field phone is sharing', await until(async () => /Race Control has your position/.test(await text(F, '#fdShare')), 12000), await text(F, '#fdShare'));
  check('and shows on the board', await until(async () => /Demo sweep/.test(await text(C, '#rcLive')) && await C.evaluate(() => document.querySelectorAll('.rc-phone').length > 0), 12000), (await text(C, '#rcLive')).slice(-200));
  await R.evaluate(() => GPTLive.fault('Crash test fault', location.origin + '/js/runner.js', 12, 3, 'at x (' + location.origin + '/js/runner.js:12:3)'));
  check('a fault report reaches the board', await until(async () => /1 kind of fault/.test(await text(C, '#rcLive')), 12000), (await text(C, '#rcLive')).slice(-200));
  check('no script from a notice ran', (await Promise.all([C, R, F].map(p => p.evaluate(() => window.__xss)))).every(x => !x));
  check('the demo asked the real Worker for nothing', out === 0, out);
  check('no errors on the three pages', !errs.length, errs.slice(0, 3));
  await b.close();
}

// ---------------------------------------------------------------- worker: the phone apps against the local Worker
async function worker() {
  console.log('\n== worker: the phone apps against the Worker on this computer ==');
  const up = await fetch(API + '/__wipe').then(r => r.ok).catch(() => false);
  if (!up) { check('the local Worker is running on ' + API + ' (node tools/crashtest/worker-local.mjs, Node 22.5 or later)', false); return; }
  await fetch(FEEDS + '__step?n=0');
  await rc('/rc/settings', { patch: { help_on: true, field_code: 'TEAM26' }, who: 'test' });
  // A board that is open asks for its state every few seconds: this stands in for it.
  const beat = setInterval(() => rc('/rc/state?since=0').catch(() => { }), 20000); await rc('/rc/state?since=0');
  await sleep(11000);   // (the Worker remembers what it tells the phones for 10 seconds)
  const b = await launch();
  const init = () => { window.__xss = 0; window.alert = () => { window.__xss++; }; window.__vib = []; try { navigator.vibrate = p => { window.__vib.push(p); return true; }; } catch (e) { } };
  const mk = async (path, o) => { const x = await open(b, null, Object.assign({ phone: true, storage: SEEN, init }, o)); await x.ctx.route(/workers\.dev|what3words/, r => r.abort()); await x.page.goto(BASE + path, { waitUntil: 'load' }); return x; };

  // ---- notices
  await rc('/rc/notice', { text: 'Course change at Mt William <img src=x onerror=alert(1)>', level: 'alert', aud: 'all', mins: 60, who: 'test' });
  await rc('/rc/notice', { text: 'Soup for runners', level: 'info', aud: 'runner', mins: 60, who: 'test' });
  await rc('/rc/notice', { text: 'Sweeps check in', level: 'info', aud: 'field', mins: 60, who: 'test' });
  await sleep(11000);
  const R = await mk(`runner.html?api=${API}&gps=${FEEDS}live/`, { geo: HALLS }), F = await mk(`field.html?api=${API}&gps=${FEEDS}live/`, { geo: { latitude: -37.2105, longitude: 142.52, accuracy: 6 } });
  await sleep(3500);
  let t = await text(R.page, '#gptNotices');
  check('runner app: the notices for every phone and for runners, not the field one', /Course change/.test(t) && /Soup for runners/.test(t) && !/Sweeps check in/.test(t), t);
  t = await text(F.page, '#gptNotices');
  check('field app: the notices for every phone and for the field, not the runners\' one', /Course change/.test(t) && /Sweeps check in/.test(t) && !/Soup for runners/.test(t), t);
  await tap(R.page, '.lv-n.lv-alert .lv-n-x'); await sleep(300);
  check('a hidden important notice folds to a bar, and comes back', /1 important notice/.test(await text(R.page, '#gptNotices')) && await tap(R.page, '.lv-n-more') && /Course change/.test(await text(R.page, '#gptNotices')), await text(R.page, '#gptNotices'));

  // ---- a help request from the runner app
  await until(() => R.page.evaluate(() => GPTLive.help.open()), 8000);
  await R.page.evaluate(() => GPTRunner.setTab('help')); await sleep(600);
  check('runner app: Tell Race Control is offered while a board is watching', !!(await text(R.page, '#rnRc')));
  await tap(R.page, '#rnRcSend');
  check('it asks what is happening before sending', /Choose what/.test(await text(R.page, '#rnRcMsg')), await text(R.page, '#rnRcMsg'));
  await R.page.fill('#rnRcBib', '1047'); await tap(R.page, 'input[name=rnRcWhat][value=hurt]'); await R.page.fill('#rnRcNote', 'Rolled ankle <b>x</b>'); await tap(R.page, '#rnRcSend');
  check('the request is sent with the position', await until(async () => /Sent at/.test(await text(R.page, '#rnRcBody')) && /km \d/.test(await text(R.page, '#rnRcBody')), 12000), await text(R.page, '#rnRcBody'));
  let st = await rc('/rc/state?since=0'), inc = (st.incidents || []).find(i => i.source === 'runner');
  check('the board has it: bib, km, urgent, to be acknowledged', !!inc && inc.bib === '1047' && inc.km > 40 && inc.severity === 'urgent' && inc.needsAck === true && /Rolled ankle/.test(inc.desc), inc);
  if (inc) await rc('/rc/incident', { id: inc.id, patch: { needsAck: false, ackAt: Date.now(), ackBy: 'test' }, note: 'Acknowledged', who: 'test' });
  check('the phone says Race Control has it', await until(async () => /Race Control has your message/.test(await text(R.page, '#rnRcBody')), 32000), await text(R.page, '#rnRcBody'));
  await tap(R.page, '#rnRcNew'); await sleep(300);
  await R.ctx.setOffline(true);
  await tap(R.page, 'input[name=rnRcWhat][value=lost]'); await tap(R.page, '#rnRcSend');
  check('with no signal the request waits on the phone', await until(async () => /No signal yet/.test(await text(R.page, '#rnRcBody')), 30000), await text(R.page, '#rnRcBody'));
  await R.ctx.setOffline(false); await R.page.evaluate(() => window.dispatchEvent(new Event('online')));
  check('and goes when signal returns', await until(async () => /Sent at/.test(await text(R.page, '#rnRcBody')), 20000), await text(R.page, '#rnRcBody'));

  // ---- the field app: on the Control map, and a location onto the board
  await until(() => F.page.evaluate(() => GPTLive.field.available()), 8000);
  await F.page.evaluate(() => GPTFieldTab('where')); await sleep(500);
  await F.page.fill('#fdShareName', 'Sweep 9'); await F.page.fill('#fdShareCode', 'WRONG'); await tap(F.page, '#fdShareForm button'); await sleep(1500);
  check('field app: a wrong team code is refused', /isn't right/.test(await text(F.page, '#fdShareErr')), await text(F.page, '#fdShareErr'));
  await F.page.fill('#fdShareCode', 'team26'); await tap(F.page, '#fdShareForm button');
  check('the right one starts sharing', await until(async () => /Race Control has your position/.test(await text(F.page, '#fdShare')), 12000), await text(F.page, '#fdShare'));
  st = await rc('/rc/state?since=0');
  check('the board has the field phone', (st.live.field || []).some(f => f.name === 'Sweep 9' && Math.abs(f.lat + 37.2105) < 0.001), st.live.field);
  await F.page.fill('#fdNote', 'Runner 212 cold'); await tap(F.page, '#fdRcSend');
  check('field app: a location goes onto the board', await until(async () => /On the Control board as #\d+/.test(await text(F.page, '#fdRcMsg')), 12000), await text(F.page, '#fdRcMsg'));
  st = await rc('/rc/state?since=0'); inc = (st.incidents || []).find(i => i.source === 'field');
  check('with the call sign and the note', !!inc && /Sweep 9/.test(inc.reporter) && /Runner 212 cold/.test(inc.desc) && inc.lat != null, inc);

  // ---- fault reports
  await R.page.evaluate(() => GPTLive.fault('Crash test fault', location.origin + '/js/runner.js?v=1', 12, 3, 'at x (' + location.origin + '/js/runner.js:12:3)')); await sleep(1200);
  const fa = (await rc('/rc/faults')).faults || [], f0 = fa.find(x => x.msg === 'Crash test fault');
  check('a fault on a phone reaches the Worker, with the app and file and nothing about the person', !!f0 && f0.app === 'runner' && f0.src === 'runner.js' && !/1047|-37\./.test(JSON.stringify(f0)), fa[0]);

  // ---- help requests switched off
  await rc('/rc/settings', { patch: { help_on: false }, who: 'test' }); await sleep(11000);
  await tap(R.page, '#rnRcNew'); await R.page.evaluate(() => GPTLive.refresh()); await sleep(1500);
  check('switched off on the board, the card goes from the runner app', !(await text(R.page, '#rnRc')), await text(R.page, '#rnRc'));
  await rc('/rc/settings', { patch: { help_on: true }, who: 'test' });
  check('no script from a notice ran', !(await R.page.evaluate(() => window.__xss)) && !(await F.page.evaluate(() => window.__xss)));
  pageErrors('runner app', R.log); pageErrors('field app', F.log);
  await R.ctx.close(); await F.ctx.close();

  // ---- Follow me and the buzz off the course
  {
    const X = await mk(`runner.html?gps=${FEEDS}empty/`, { geo: HALLS }); await sleep(2000);
    await X.page.evaluate(() => GPTRunner.setTab('map')); await sleep(600);
    await tap(X.page, '#rnFollowMe'); await sleep(2500);
    check('Follow me places the runner on the course', /Km 49/.test(await text(X.page, '.prof-info')), await text(X.page, '.prof-info'));
    for (let i = 0; i < 10; i++) { await X.ctx.setGeolocation({ latitude: HALLS.latitude + 0.0015 + i * 1e-6, longitude: HALLS.longitude + 0.001, accuracy: 9 }); await sleep(3000); }
    check('about 130 m off the course for 30 seconds: one buzz and the way back', (await X.page.evaluate(() => window.__vib.length)) === 1 && /off the course/.test(await text(X.page, '#rnToast')), [await X.page.evaluate(() => window.__vib.length), await text(X.page, '#rnToast')]);
    await X.ctx.setGeolocation(HALLS); await sleep(3000);
    check('back on the course, the warning goes', !(await text(X.page, '#rnToast')));
    pageErrors('Follow me', X.log); await X.ctx.close();
  }

  // ---- the latest positions first, and slower updates off screen
  {
    const X = await open(b, null, { phone: true, storage: SEEN }); await X.ctx.route(/workers\.dev|what3words/, r => r.abort());
    const reqs = []; X.page.on('request', r => { if (/\/gps\//.test(r.url())) reqs.push(r.url().replace(/^https?:\/\/[^/]+/, '')); });
    await X.page.goto(`${BASE}runner.html?gps=mid&api=${API}`, { waitUntil: 'load' });
    await X.page.waitForFunction(() => window.GPTTracking && GPTTracking.ready(), null, { timeout: 30000 });
    const first = await X.page.evaluate(() => ({ n: GPTTracking.list().filter(r => r.pos && r.pos.src === 'gps').length, partial: GPTTracking.state.partial }));
    check('phones take the end of the positions file first, and everyone is on the map from it', reqs.some(u => /data\.lst\?tail=/.test(u)) && first.n === 400 && first.partial === true, [first, reqs]);
    check('then the whole file follows', await until(() => X.page.evaluate(() => GPTTracking.state.partial === false && [...GPTTracking.state.runners.values()].every(r => !r.pts.length || r.pts.length > 50)), 15000), reqs);
    await X.page.evaluate(() => { Object.defineProperty(document, 'hidden', { get: () => window.__hid === true, configurable: true }); window.__hid = true; document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(17000); let n0 = reqs.length; await sleep(32000);
    check('off screen: no new positions asked for in 32 seconds (once a minute, not every 15 s)', reqs.length - n0 === 0, reqs.slice(n0));
    n0 = reqs.length; await X.page.evaluate(() => { window.__hid = false; document.dispatchEvent(new Event('visibilitychange')); }); await sleep(1500);
    check('back on screen: it catches up at once', reqs.length - n0 >= 1, reqs.slice(n0));
    pageErrors('positions', X.log); await X.ctx.close();
  }
  await b.close();

  // ---- alerts: needs the full browser (the headless shell has no notifications). Skipped where it isn't installed.
  let full = null; try { full = await chromium.launch({ channel: 'chromium' }); } catch (e) { console.log('  (alerts not tested: the full Chromium isn\'t installed. npx playwright install chromium)'); }
  if (full) {
    const ctx = await full.newContext(Object.assign({}, devices['Pixel 7'], { timezoneId: 'Australia/Melbourne', locale: 'en-AU', serviceWorkers: 'allow', permissions: ['notifications'] }));
    await ctx.addInitScript(([s, api]) => {
      try { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); } catch (e) { }
      // A stand-in for the browser's own push service: the address a subscription gets is the local Worker's stand-in.
      const K = '__fakeSub', mkSub = ep => ({ endpoint: ep, unsubscribe: async () => { localStorage.removeItem(K); return true; }, toJSON: () => ({ endpoint: ep }) });
      if (window.PushManager) {
        PushManager.prototype.getSubscription = async function () { const ep = localStorage.getItem(K); return ep ? mkSub(ep) : null; };
        PushManager.prototype.subscribe = async function () { const ep = api + '/__pushsvc/phone-' + Math.random().toString(36).slice(2, 10); localStorage.setItem(K, ep); return mkSub(ep); };
      }
    }, [SEEN, API]);
    await ctx.route(/workers\.dev|what3words/, r => r.abort());
    const page = await ctx.newPage(), errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 300)));
    await page.goto(`${BASE}runner.html?api=${API}&gps=${FEEDS}live/`, { waitUntil: 'load' });
    await page.evaluate(() => navigator.serviceWorker.ready); await sleep(3500);
    await tap(page, '.rn-nav button[data-tab="track"]'); await sleep(1200);
    await page.fill('#tkFind', '1000'); await sleep(900); await tap(page, '#tkHits button[data-follow]'); await sleep(500);
    check('the Track tab offers alerts', /Turn on alerts/.test(await text(page, '#tkAlerts')), await text(page, '#tkAlerts'));
    await tap(page, '#tkAlerts button[data-push="on"]');
    check('alerts turn on for the runner followed', await until(async () => /Alerts are on for the 1 runner/.test(await text(page, '#tkAlerts')), 8000), await text(page, '#tkAlerts'));
    await fetch(API + '/__cron'); await sleep(300);                    // the first look at the timing list is not news
    await fetch(FEEDS + '__step?n=2'); await fetch(API + '/__cron'); await sleep(600);   // bib 1000 reaches Halls Gap
    const cdp = await ctx.newCDPSession(page), regs = []; cdp.on('ServiceWorker.workerRegistrationUpdated', e => regs.push(...e.registrations));
    await cdp.send('ServiceWorker.enable'); await sleep(800);
    const reg = regs.find(r => r.scopeURL.startsWith(ORIGIN));
    if (reg) await cdp.send('ServiceWorker.deliverPushMessage', { origin: ORIGIN, registrationId: reg.registrationId, data: '' });
    await sleep(2500);
    const notes = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => ({ title: n.title, body: n.body, url: n.data && n.data.url })));
    check('a followed runner reaching a checkpoint becomes a notification', notes.some(n => /bib 1000/.test(n.title) && /Halls Gap/.test(n.body) && /bib=1000/.test(n.url || '')), notes);
    await tap(page, '#tkAlerts button[data-push="off"]');
    check('alerts turn off again', await until(async () => /Turn on alerts/.test(await text(page, '#tkAlerts')), 8000) && (await rc('/rc/state?since=0')).live.alerts === 0, await text(page, '#tkAlerts'));
    check('alerts: no errors on the page', !errs.length, errs.slice(0, 3));
    await fetch(FEEDS + '__step?n=0');
    await full.close();
  }
  clearInterval(beat);
}

(async () => {
  const part = process.argv[2] || 'demo';
  if (part === 'demo' || part === 'all') await demo();
  if (part === 'worker' || part === 'all') await worker();
  console.log('\n==== ' + issues.length + ' issue(s) ====');
  issues.forEach(i => console.log('- ' + i));
  process.exit(0);
})().catch(e => { console.log('HARNESS ERROR', e); process.exit(2); });
