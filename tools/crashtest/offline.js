// Crash test: no signal. Opens one app with signal so the build saves itself (the service worker), cuts the network,
// then opens and uses every app. Each must load, with its map library and fonts, and Find must still answer.
//   node tools/crashtest/offline.js
const { chromium, devices } = require('playwright');
const { BASE } = require('./lib');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const issues = [];
const note = (w, x) => { issues.push(w + ': ' + x); console.log('  !!', w, '::', String(x).slice(0, 500)); };
const quiet = x => /status of 401|ERR_INTERNET_DISCONNECTED|ERR_FAILED|ERR_ABORTED|Failed to load resource|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|ERR_TUNNEL/.test(x);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext(Object.assign({}, devices['iPhone 13'], { serviceWorkers: 'allow', timezoneId: 'Australia/Melbourne', geolocation: { latitude: -37.14067, longitude: 142.51921, accuracy: 8 }, permissions: ['geolocation'] }));
  await ctx.addInitScript(() => { try { ['gptIntroSafety', 'gptIntroMap', 'gptIntroField'].forEach(k => localStorage.setItem(k, '1')); localStorage.setItem('rn.introDone', 'true'); } catch (e) { } });
  await ctx.route(/workers\.dev/, r => r.abort());
  const page = await ctx.newPage(), errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !quiet(m.text())) errs.push('console: ' + m.text().slice(0, 300)); });
  const drain = w => errs.splice(0).forEach(e => note(w, e));
  await page.goto(BASE + 'field.html', { waitUntil: 'load' }); await sleep(9000);
  const s = await page.evaluate(async () => { const out = {}; for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).length; return { caches: out, controller: !!navigator.serviceWorker.controller }; });
  console.log('saved:', JSON.stringify(s));
  if (!Object.keys(s.caches).some(k => /^gpt100-v\d+$/.test(k) && s.caches[k] > 50)) note('install', 'the build did not save itself: ' + JSON.stringify(s));
  drain('install');
  await ctx.setOffline(true);
  for (const path of ['index.html', 'map.html', 'field.html', 'runner.html', 'admin.html', '', 'runner.html?demo=1', 'field.html?demo=1', 'index.html?demo=1#bib=1010']) {
    const w = `offline ${path || '/'}`;
    await page.goto(BASE + path, { waitUntil: 'load', timeout: 30000 }).catch(e => note(w, 'did not load: ' + e.message.slice(0, 120)));
    await sleep(2500);
    const st = await page.evaluate(() => ({ L: !!window.L, G: !!window.GPT, body: document.body.innerText.length, text: document.fonts.check('600 14px Montserrat') })).catch(e => ({ err: e.message }));
    console.log(`  ${path || '/'}: ${JSON.stringify(st)}`);
    if (st.err || !st.L || (!/admin/.test(path) && !st.G) || st.body < 100) note(w, 'broken with no signal: ' + JSON.stringify(st));
    if (!st.text) note(w, 'the text font is missing with no signal');
    const tabs = await page.evaluate(() => document.querySelectorAll('.rn-nav button, .tab-btn[data-tab]').length).catch(() => 0);
    for (let i = 0; i < tabs; i++) { await page.evaluate(i => { const b = document.querySelectorAll('.rn-nav button, .tab-btn[data-tab]')[i]; if (b) b.click(); }, i); await sleep(350); }
    if (/^index/.test(path)) { await page.evaluate(() => document.querySelector('.tab-btn[data-tab="find"]').click()); await page.fill('#q', '87.3'); await page.evaluate(() => document.getElementById('findForm').requestSubmit()); await sleep(1200); const r = await page.evaluate(() => document.getElementById('result').innerText.slice(0, 60)); if (!/87\.3/.test(r)) note(w, 'Find gave: ' + r); }
    if (/^(field|runner)/.test(path)) { await page.evaluate(() => { const b = document.querySelector('.rn-nav button[data-tab="map"]'); if (b) b.click(); }); await sleep(300); await page.evaluate(() => { const l = document.querySelector('.rn-locbtn'); if (l) l.click(); }); await sleep(2500); }
    drain(w);
  }
  await b.close();
  console.log('\n==== ' + issues.length + ' issue(s) ====');
  issues.forEach(i => console.log('- ' + i.slice(0, 900)));
  process.exit(issues.length ? 1 : 0);
})().catch(e => { console.log('TEST SCRIPT ERROR', e); process.exit(2); });
