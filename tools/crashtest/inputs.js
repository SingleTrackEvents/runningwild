// Crash test: every app, every tab, with bad and hostile input, broken links and damaged saved settings.
// Anything that throws, logs an error or runs injected script is reported. One part at a time:
//   node tools/crashtest/inputs.js [staff|map|field|runner|storage]
const { launch, open, sleep, BASE, FEEDS } = require('./lib');
const issues = [];
const note = (where, what) => { issues.push(where + ': ' + what); console.log('  !!', where, '::', String(what).slice(0, 500)); };
const quiet = x => /Service Worker registration blocked|status of 401|net::ERR_FAILED|ERR_ABORTED|Failed to load resource: net::ERR/.test(x);
function drain(log, where) {
  log.errors.splice(0).forEach(e => note(where, 'PAGE ERROR ' + e));
  log.console.splice(0).filter(x => !quiet(x)).forEach(e => note(where, 'console ' + e));
}
// Anything that would open a dialog or an XSS marker.
const INIT = () => { window.__xss = 0; window.alert = () => { window.__xss++; }; window.confirm = () => true; window.prompt = () => null; };
const FUZZ = ['', ' ', '87.3', '87,3', '-5', '0', '164.6', '164.7', '999', '1e9', '1e400', 'abc', '52-54', '52 54', '-37.294, 142.601', '-37.294 142.601', '0,0', '90,180', '-91, 500', '///word.word.word', '///a.b', '///', 'word.word.word',
  '#1047', '#1010', '#99999', '#', 'bib 1010', 'bib', '1010', '<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "';alert(1)//", 'x'.repeat(5000), '🏃‍♂️💥', 'NaN', 'Infinity', '-Infinity', 'null', 'undefined',
  "-37° 17.640', 142° 36.060'", '37°17\'38.4"S 142°36\'03.6"E', '87.3km', 'km 87.3', 'KM87.3', '87..3', '8 7 . 3', '‮87.3', '١٢٣', '0x10', '1/0', '%00', '../../etc/passwd', '-0', '+87.3', '87.3.1'];

const only = process.argv[2] || '';
(async () => {
  const b = await launch();
  const block = async ctx => { await ctx.route(/workers\.dev/, r => r.abort()); };

  // ---------- A. staff app: tabs and Find fuzz ----------
  if (!only || only === 'staff') for (const phone of [false, true]) {
    const where = 'staff' + (phone ? '-phone' : '');
    console.log(where);
    const { ctx, page, log } = await open(b, null, { phone, init: INIT, storage: { gptIntroSafety: '1' } });
    await block(ctx);
    await page.goto(BASE + 'index.html?demo=1', { waitUntil: 'load' });
    await sleep(3000); drain(log, where + ' load');
    for (const q of FUZZ) {
      await page.fill('#q', q).catch(e => note(where, 'fill ' + e.message));
      await page.evaluate(() => document.getElementById('findForm').requestSubmit());
      await sleep(120);
      const x = await page.evaluate(() => ({ xss: window.__xss, msg: document.getElementById('qMsg').textContent, res: document.getElementById('result').innerText.slice(0, 80) }));
      if (x.xss) note(where, 'XSS with ' + q);
      if (log.errors.length || log.console.filter(c => !quiet(c)).length) { drain(log, where + ' find "' + q.slice(0, 40) + '"'); }
    }
    // a good find, then every button in the result
    await page.fill('#q', '87.3'); await page.evaluate(() => document.getElementById('findForm').requestSubmit()); await sleep(1500);
    drain(log, where + ' find 87.3');
    for (const t of ['wx', 'med', 'rc', 'risk', 'find']) {
      await page.click(`.tab-btn[data-tab="${t}"]`).catch(e => note(where, 'tab ' + t + ' ' + e.message)); await sleep(1800);
      drain(log, where + ' tab ' + t);
      const txt = await page.evaluate(t => (document.getElementById('tab-' + t) || {}).innerText || '', t);
      if (txt.trim().length < 20) note(where, 'tab ' + t + ' looks empty: "' + txt.trim().slice(0, 60) + '"');
    }
    // deep links
    for (const h of ['#bib=1010', '#bib=99999', '#bib=abc', '#ll=-37.2,142.5', '#ll=0,0', '#ll=abc', '#km=87.3', '#km=-1', '#ll=-37.14,142.52&c=14k', '#c=nope', '#%%%']) {
      await page.goto(BASE + 'index.html?demo=1' + h, { waitUntil: 'load' }).catch(e => note(where, 'goto ' + h + ' ' + e.message)); await page.reload({ waitUntil: 'load' }); await sleep(1800);
      drain(log, where + ' link ' + h);
    }
    await ctx.close();
  }

  // ---------- B. map page ----------
  if (!only || only === 'map') for (const phone of [false, true]) {
    const where = 'map' + (phone ? '-phone' : '');
    console.log(where);
    const { ctx, page, log } = await open(b, null, { phone, init: INIT, storage: { gptIntroMap: '1' } });
    await block(ctx);
    for (const h of ['', '#bib=1010', '#bib=99999', '#bib=', '#bib=<b>']) {
      await page.goto(BASE + 'map.html?demo=1' + h, { waitUntil: 'load' }); await page.reload({ waitUntil: 'load' }); await sleep(2500);
      drain(log, where + ' ' + h);
    }
    // tap around the map, open the Runners panel, search bibs
    const box = await page.locator('#map').boundingBox();
    for (let i = 0; i < 12; i++) { await page.mouse.click(box.x + box.width * (0.15 + 0.07 * i), box.y + box.height * (0.2 + 0.05 * i)); await sleep(150); }
    drain(log, where + ' map clicks');
    if (await page.evaluate(() => document.getElementById('mpPanel').hidden)) { await page.click('#mpRunners'); await sleep(600); }
    for (const q of ['1010', '', 'abc', '99999', '<img src=x onerror=alert(1)>', '#1004', 'bib 1013']) { if (await page.evaluate(() => document.getElementById('mpPanel').hidden)) { await page.click('#mpRunners'); await sleep(400); } await page.fill('#mpBib', q); await page.evaluate(() => document.getElementById('mpBibForm').requestSubmit()); await sleep(250); }
    if (await page.evaluate(() => window.__xss)) note(where, 'XSS in bib search');
    drain(log, where + ' runners panel');
    // layers on and off
    await page.evaluate(() => document.querySelectorAll('.leaflet-control-layers input').forEach(i => i.click())); await sleep(800);
    await page.evaluate(() => document.querySelectorAll('.leaflet-control-layers input').forEach(i => i.click())); await sleep(500);
    drain(log, where + ' layers');
    await ctx.close();
  }

  // ---------- C. field app ----------
  if (!only || only === 'field') {
    const where = 'field';
    console.log(where);
    const { ctx, page, log } = await open(b, null, { phone: true, init: INIT, storage: { gptIntroField: '1' }, geo: { latitude: -37.14067, longitude: 142.51921, accuracy: 8 } });
    await block(ctx);
    await page.goto(BASE + 'field.html?demo=1', { waitUntil: 'load' }); await sleep(3000); drain(log, where + ' load');
    for (const t of ['map', 'where', 'race', 'home', 'where']) { await page.click(`.rn-nav button[data-tab="${t}"]`); await sleep(500); drain(log, where + ' tab ' + t); }
    for (const q of ['', ' ', '12.5', '12,5', '.5', '-1', '9999', 'abc', '1e3', '<img src=x onerror=alert(1)>', '164.6', '164.7', '0', 'km 30', '30 km', '٣']) {
      await page.fill('#fdKm', q); await page.evaluate(() => document.getElementById('fdKmForm').requestSubmit()); await sleep(250);
      if (log.errors.length || log.console.filter(c => !quiet(c)).length) drain(log, where + ' km "' + q + '"');
    }
    await page.fill('#fdKm', '49.5'); await page.evaluate(() => document.getElementById('fdKmForm').requestSubmit()); await sleep(800);
    await page.fill('#fdNote', '<b>bold</b> "quotes" & ampersand \n new line 🏃'); await sleep(200);
    const href = await page.getAttribute('#fdSend', 'href'); if (!/^https:\/\/wa\.me\/\?text=/.test(href || '')) note(where, 'send link ' + href);
    await page.click('#fdLocate'); await sleep(2500); drain(log, where + ' locate');
    for (const r of await page.$$eval('#fdRace option', o => o.map(x => x.value))) {
      await page.click('.rn-nav button[data-tab="race"]'); await page.selectOption('#fdRace', r); await sleep(500);
      const nst = await page.evaluate(() => document.getElementById('fdStages').hidden ? 0 : document.querySelectorAll('#fdStages button').length);
      for (let i = 0; i < nst; i++) { await page.locator('#fdStages button').nth(i).click(); await sleep(250); }
      for (const t of ['', '32', '3200', '99:99', 'abc', '0', '-1', '1:60', '250', '32:00']) { await page.fill('#fdTarget', t); await sleep(60); }
      await page.click('.rn-nav button[data-tab="map"]'); await sleep(500);
      await page.click('.rn-nav button[data-tab="home"]'); await sleep(300);
      drain(log, where + ' race ' + r);
    }
    if (await page.evaluate(() => window.__xss)) note(where, 'XSS');
    // Runners panel on the phone
    await page.click('.rn-nav button[data-tab="map"]'); await sleep(500);
    await page.click('#fdRunners'); await sleep(700);
    await page.fill('#mpBib', '1010'); await page.evaluate(() => document.getElementById('mpBibForm').requestSubmit()); await sleep(1200);
    drain(log, where + ' runners');
    await ctx.close();
  }

  // ---------- D. runner app ----------
  if (!only || only === 'runner') {
    const where = 'runner';
    console.log(where);
    const { ctx, page, log } = await open(b, null, { phone: true, init: INIT, storage: { 'rn.introDone': 'true' }, geo: { latitude: -37.14067, longitude: 142.51921, accuracy: 8 } });
    await block(ctx);
    await page.goto(BASE + 'runner.html?demo=1', { waitUntil: 'load' }); await sleep(3000); drain(log, where + ' load');
    const races = await page.$$eval('#rnRace option', o => o.map(x => x.value));
    for (const mode of ['runner', 'crew']) {
      await page.click(`.rn-mode button[data-m="${mode}"]`); await sleep(200);
      for (const r of races) {
        await page.selectOption('#rnRace', r); await sleep(300);
        const n = await page.evaluate(() => document.getElementById('rnStages').hidden ? 0 : document.querySelectorAll('#rnStages button').length);
        for (let i = 0; i < Math.max(1, n); i++) {
          if (n) { await page.locator('#rnStages button').nth(i).click(); await sleep(150); }
          for (const t of ['home', 'map', 'aid', 'help', 'track', 'schedule', 'gear']) { await page.click(`.rn-nav button[data-tab="${t}"]`); await sleep(160); }
          await page.click('.rn-nav button[data-tab="map"]'); await sleep(250);
          await page.click('.rn-locbtn').catch(() => { }); await sleep(900);
          await page.click('.rn-nav button[data-tab="home"]'); await sleep(100);
        }
        if (log.errors.length || log.console.filter(c => !quiet(c)).length) drain(log, `${where} ${mode} race ${r}`);
      }
    }
    await page.selectOption('#rnRace', races[0]);
    await page.click('.rn-nav button[data-tab="aid"]');
    for (const t of ['', '32', '3200', '99:99', 'abc', '0', '-1', '1:60', '250', '32:00', '<img src=x onerror=alert(1)>', '24.5', '24h30']) { await page.fill('#rnTarget', t); await sleep(60); }
    drain(log, where + ' target');
    await page.click('.rn-nav button[data-tab="help"]'); await sleep(300);
    for (const l of await page.$$eval('#rnLang option', o => o.map(x => x.value))) { await page.selectOption('#rnLang', l); await sleep(300); await page.click('#rnLangFlip').catch(() => { }); await sleep(150); await page.click('#rnLangFlip').catch(() => { }); await page.click('#rnW3wGet'); await sleep(700); drain(log, where + ' lang ' + l); }
    await page.selectOption('#rnLang', 'en');
    await page.evaluate(() => document.querySelectorAll('.rn-card summary, .rn-card details').forEach(d => d.click && d.click()));
    await page.click('.rn-nav button[data-tab="track"]'); await sleep(400);
    for (const q of ['1', '10', '1010', 'a', 'smith', 'zzzz', '<img src=x onerror=alert(1)>', '#1004', 'bib 1013', ' ', 'é', '(', '[', '\\', '.*']) { await page.fill('#tkFind', q); await sleep(120); }
    if (await page.evaluate(() => window.__xss)) note(where, 'XSS in track search');
    await page.fill('#tkFind', '10'); await sleep(300);
    const fol = page.locator('#tkHits button[data-follow]'); const fn = await fol.count();
    for (let i = 0; i < Math.min(5, fn); i++) { await page.locator('#tkHits button[data-follow]').nth(i).click(); await sleep(200); }
    await page.fill('#tkFind', ''); await sleep(200);
    for (const sel of ['button[data-open]', 'button[data-map]']) { const c = await page.locator(sel).count(); if (c) { await page.locator(sel).first().click(); await sleep(700); await page.click('.rn-nav button[data-tab="track"]'); await sleep(300); } }
    for (const g of ['F', 'M', '']) { await page.click(`.tk-filter button[data-g="${g}"]`).catch(() => { }); await sleep(150); }
    await page.click('button[data-all]').catch(() => { }); await sleep(300);
    drain(log, where + ' track');
    for (const h of ['#bib=1010', '#bib=abc', '#bib=', '#bib=99999999999999999999']) { await page.goto(BASE + 'runner.html?demo=1' + h, { waitUntil: 'load' }); await page.reload({ waitUntil: 'load' }); await sleep(1500); drain(log, where + ' link ' + h); }
    await ctx.close();
  }

  // ---------- E. corrupt storage: every key set to rubbish ----------
  const KEYS = ['rn.tab', 'rn.mode', 'rn.race', 'rn.stage.miler', 'rn.stage.stage', 'rn.target.miler.miler', 'rn.seen.miler.miler', 'rn.schedFor', 'rn.saveInBrowser', 'rn.profOpen', 'rn.lang', 'rn.introDone', 'rn.gear.miler', 'rn.follow', 'rn.everyone', 'rn.everyKey', 'rn.everyHide', 'rn.cardTicks', 'rn.cardOpen', 'rn.trackSaved', 'rn.trackOpen',
    'fd.tab2', 'fd.stage.miler', 'fd.stage.stage', 'fd.race', 'fd.note', 'fd.here', 'fd.follow', 'fd.target.miler.miler', 'fdTrail', 'gptWxGrid', 'gptMapKey', 'gptMapPanel', 'gpt100_medplan_key', 'gptIntroSafety', 'gptIntroMap', 'gptIntroField', 'gptCourseView2', 'gptBase'];
  if (!only || only === 'storage') for (const junk of ['{', 'null', '[]', '{}', '"x"', '12345', 'true', '[null,{"a":1},"<img src=x onerror=alert(1)>"]', '{"id":"nope","day":"x","lat":"a","lon":null,"t":"z","cid":"zz","ic":-5}', 'x'.repeat(20000)]) {
    const storage = {}; KEYS.forEach(k => storage[k] = junk);
    for (const path of ['index.html?demo=1', 'map.html?demo=1', 'field.html?demo=1', 'runner.html?demo=1', 'runner.html', 'field.html']) {
      const where = `storage ${junk.slice(0, 18)} ${path}`;
      const { ctx, page, log } = await open(b, null, { phone: /field|runner/.test(path), init: INIT, storage });
      await block(ctx);
      await page.goto(BASE + '' + path, { waitUntil: 'load' }).catch(e => note(where, e.message)); await sleep(2200);
      // walk the tabs
      const tabs = await page.$$('.rn-nav button, .tab-btn[data-tab]');
      for (let i = 0; i < tabs.length; i++) { await page.evaluate(i => { const b = document.querySelectorAll('.rn-nav button, .tab-btn[data-tab]')[i]; if (b) b.click(); }, i); await sleep(250); }
      if (await page.evaluate(() => window.__xss)) note(where, 'XSS from storage');
      drain(log, where);
      await ctx.close();
    }
  }
  await b.close();
  console.log('\n==== ' + issues.length + ' issue(s) ====');
  [...new Set(issues)].forEach(i => console.log('- ' + i.slice(0, 700)));
  process.exit(issues.length ? 1 : 0);
})().catch(e => { console.log('TEST SCRIPT ERROR', e); process.exit(2); });
