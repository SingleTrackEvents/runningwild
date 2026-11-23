// Crash test: broken and hostile tracking and timing feeds (served by feeds.js), GPS trouble on the phone, and the
// clock before, during and after the race. One part at a time: node tools/crashtest/feeds-gps-clock.js [feeds|gps|clock]
const { launch, open, sleep, BASE, FEEDS } = require('./lib');
const issues = [];
const note = (where, what) => { issues.push(where + ': ' + what); console.log('  !!', where, '::', String(what).slice(0, 600)); };
const quiet = x => /Service Worker registration blocked|status of 401|net::ERR_FAILED|ERR_ABORTED|Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_CONNECTION/.test(x);
function drain(log, where) {
  log.errors.splice(0).forEach(e => note(where, 'PAGE ERROR ' + e));
  log.console.splice(0).filter(x => !quiet(x)).forEach(e => note(where, 'console ' + e));
}
const INIT = () => { window.__xss = 0; window.alert = () => { window.__xss++; }; window.confirm = () => true; window.prompt = () => null; };
const only = process.argv[2] || '';
(async () => {
  const b = await launch();
  const block = async ctx => { await ctx.route(/workers\.dev/, r => r.abort()); };
  const SEEN = { gptIntroSafety: '1', gptIntroMap: '1', gptIntroField: '1', 'rn.introDone': 'true', 'rn.follow': '["1000","1001","2000","2007","1009"]' };

  // ---------- F. feeds ----------
  if (!only || only === 'feeds') for (const c of ['ok', 'garbage', 'empty', 'html', 'err500', 'err404', 'weird', 'shapes', 'nolabels', 'errorobj', 'huge']) {
    for (const [path, phone] of [['index.html', false], ['map.html', false], ['field.html', true], ['runner.html', true]]) {
      const where = `feed ${c} ${path}`;
      const { ctx, page, log } = await open(b, null, { phone, init: INIT, storage: SEEN, geo: { latitude: -37.14067, longitude: 142.51921, accuracy: 8 } });
      await block(ctx);
      const t0 = Date.now();
      await page.goto(`${BASE}${path}?gps=${FEEDS}${c}/`, { waitUntil: 'load' }).catch(e => note(where, e.message));
      await sleep(c === 'huge' ? 9000 : 3500);
      const st = await page.evaluate(() => { const TR = window.GPTTracking; return TR ? { ready: TR.ready(), n: TR.list().length, status: TR.status().slice(0, 260), xss: window.__xss } : { none: true, xss: window.__xss }; }).catch(e => ({ evalError: e.message }));
      if (st.xss) note(where, 'XSS from the feed');
      if (st.evalError) note(where, 'page hung or died: ' + st.evalError);
      if (path === 'index.html') console.log(`  ${c}: ${JSON.stringify(st).slice(0, 330)}`);
      // use the app with that feed
      if (path === 'index.html') {
        await page.fill('#q', '60').catch(() => { }); await page.evaluate(() => document.getElementById('findForm').requestSubmit()); await sleep(900);
        await page.fill('#q', '#1000').catch(() => { }); await page.evaluate(() => document.getElementById('findForm').requestSubmit()); await sleep(700);
        await page.fill('#q', '#2000').catch(() => { }); await page.evaluate(() => document.getElementById('findForm').requestSubmit()); await sleep(700);
        for (const t of ['med', 'rc', 'find']) { await page.click(`.tab-btn[data-tab="${t}"]`).catch(() => { }); await sleep(700); }
      } else if (path === 'map.html') {
        await page.click('#mpRunners').catch(() => { }); await sleep(500);
        for (const bib of ['1000', '2000', '2007', '2009', '99999999999999999999']) await page.evaluate(bib => { try { GPTMapPage.show(bib); } catch (e) { window.__err = String(e); } }, bib);
        await sleep(600);
      } else if (path === 'field.html') {
        await page.click('.rn-nav button[data-tab="map"]').catch(() => { }); await sleep(400);
        await page.click('.rn-locbtn').catch(() => { }); await sleep(1800);
        for (const bib of ['1000', '2000', '2007', '2009']) { await page.evaluate(bib => { try { GPTField.show && GPTField.show(bib); } catch (e) { window.__err = String(e); } }, bib); await sleep(300); }
        await page.click('.rn-nav button[data-tab="where"]').catch(() => { }); await sleep(500);
      } else {
        await page.click('.rn-nav button[data-tab="map"]').catch(() => { }); await sleep(400);
        await page.click('.rn-locbtn').catch(() => { }); await sleep(1800);
        await page.click('.rn-nav button[data-tab="track"]').catch(() => { }); await sleep(700);
        await page.fill('#tkFind', '10').catch(() => { }); await sleep(300);
        await page.evaluate(() => document.querySelectorAll('button[data-open]').forEach(b => b.click())); await sleep(500);
        await page.evaluate(() => { const b = document.querySelector('button[data-map]'); if (b) b.click(); }); await sleep(900);
      }
      const e2 = await page.evaluate(() => ({ err: window.__err, xss: window.__xss })).catch(e => ({ err: 'eval failed ' + e.message }));
      if (e2.err) note(where, 'threw: ' + e2.err);
      if (e2.xss) note(where, 'XSS');
      drain(log, where);
      if (c === 'huge') console.log(`  huge ${path}: ${Date.now() - t0} ms in all`);
      await ctx.close();
    }
  }

  // ---------- G. GPS trouble ----------
  // ---- trackers last heard days ago (the "ghost runners" of November 2026) must not be drawn as racing
  if (!only || only === 'feeds' || only === 'stale') {
    console.log('stale trackers');
    for (const [path, phone] of [['runner.html', true], ['field.html', true], ['map.html', false]]) {
      const { ctx, page, log } = await open(b, null, { phone, storage: SEEN });
      await ctx.route(/workers\.dev|what3words/, r => r.abort());
      await page.goto(BASE + path + '?gps=' + FEEDS + 'ghost/', { waitUntil: 'load' });
      await page.waitForFunction(() => window.GPTTracking && GPTTracking.ready() && GPTTracking.byBib('2003') && GPTTracking.byBib('2003').pos && window.GPTTiming && GPTTiming.ready(), null, { timeout: 30000 }).catch(() => { });
      await sleep(2500);
      const r = await page.evaluate(() => { const f = b => { const q = GPTTracking.byBib(b), p = q && q.pos; return p ? { est: !!p.est, on: !!p.onCourse, away: p.away || '', h: Math.round(p.ageMs / 3600e3), late: !!(p.next && p.next.late) } : null; };
        const w = GPTTracking.watch(), bibs = l => l.map(x => x.bib).join(); return { stage: f('2001'), miler: f('2002'), out: f('2003'), watch: [bibs(w.stopped), bibs(w.late), bibs(w.quiet), bibs(w.aid)].join('|') }; });
      if (!r.stage || !r.miler || !r.out) { note(path + ' stale', 'the feed did not load: ' + JSON.stringify(r)); await ctx.close(); continue; }
      if (r.stage.est || r.miler.est) note(path + ' stale', 'a tracker silent for 52 hours is still moved along the course at their pace: ' + JSON.stringify(r));
      if (r.stage.on || !r.stage.away) note(path + ' stale', 'a stage runner\'s tracker at Halls Gap, off their stage, counts as on course: ' + JSON.stringify(r.stage));
      if (r.out.est === undefined || !r.out.on) note(path + ' stale', 'the runner with a fresh fix is no longer on course: ' + JSON.stringify(r.out));
      if (/2001/.test(r.watch)) note(path + ' stale', 'the stage runner\'s tracker at Halls Gap is on the Runner watch: ' + r.watch);
      if (path === 'runner.html') {
        await page.evaluate(() => document.querySelector('.rn-nav button[data-tab="map"]').click()); await sleep(1200);
        await page.evaluate(() => { const x = document.querySelector('.tk-every-btn'); if (x && !x.classList.contains('on')) x.click(); }); await sleep(800);
        const n = await page.evaluate(() => (document.querySelector('.tk-every-btn small') || {}).textContent || '0');
        if (n !== '1') note('runner.html stale', 'Everyone on the map should be the one runner with a fresh fix, but shows ' + n);
        await page.evaluate(() => document.querySelector('.rn-nav button[data-tab="track"]').click()); await sleep(600);
        for (const [bib, want] of [['2001', /Not on the course yet|Off the course|No recent position/], ['2002', /No recent position/], ['2003', /On course/]]) {
          await page.fill('#tkFind', bib); await sleep(500);
          const t = await page.evaluate(() => document.getElementById('tkHits').innerText);
          if (!want.test(t)) note('runner.html stale', `bib ${bib} reads "${t.replace(/\s+/g, ' ').slice(0, 120)}"`);
        }
      }
      drain(log, path + ' stale');
      await ctx.close();
    }
  }
  if (!only || only === 'gps') for (const [name, opts, pre] of [
    ['denied', {}, null],  // no permission granted: the browser refuses
    ['far away (Melbourne)', { geo: { latitude: -37.8136, longitude: 144.9631, accuracy: 20 } }, null],
    ['other side of the world', { geo: { latitude: 51.5, longitude: -0.12, accuracy: 20 } }, null],
    ['poor accuracy', { geo: { latitude: -37.14067, longitude: 142.51921, accuracy: 900 } }, null],
    ['2 km off the course', { geo: { latitude: -37.16, longitude: 142.56, accuracy: 10 } }, null],
    ['no geolocation at all', {}, () => { Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true }); }],
    ['on the 14k course', { geo: { latitude: -37.1385, longitude: 142.5195, accuracy: 5 } }, null]
  ]) {
    for (const path of ['field.html?demo=1', 'runner.html?demo=1', 'index.html?demo=1']) {
      const where = `gps ${name} ${path}`;
      const { ctx, page, log } = await open(b, null, Object.assign({ phone: !/index/.test(path), init: INIT, storage: SEEN }, opts));
      if (pre) await ctx.addInitScript(pre);
      await block(ctx);
      await page.goto(BASE + '' + path, { waitUntil: 'load' }); await sleep(2500);
      if (/index/.test(path)) { await page.click('#btnGps').catch(e => note(where, e.message)); await sleep(2500); }
      else {
        await page.click('.rn-nav button[data-tab="map"]'); await sleep(400); await page.click('.rn-locbtn'); await sleep(2500);
        if (/field/.test(path)) { await page.click('.rn-nav button[data-tab="where"]'); await sleep(300); await page.click('#fdLocate'); await sleep(2000); await page.check('#fdFollow').catch(() => { }); await sleep(800); await page.uncheck('#fdFollow').catch(() => { }); }
        else { await page.click('.rn-nav button[data-tab="help"]'); await sleep(300); await page.click('#rnW3wGet'); await sleep(1500); await page.click('#rnShare').catch(() => { }); await sleep(800); await page.click('.rn-nav button[data-tab="track"]'); await sleep(500); }
      }
      drain(log, where);
      await ctx.close();
    }
  }

  // ---------- H. the clock: well before, race morning, mid race, after, and a year on ----------
  if (!only || only === 'clock') for (const iso of ['2026-06-01T10:00:00+10:00', '2026-11-05T05:00:00+11:00', '2026-11-06T07:59:30+11:00', '2026-11-07T03:00:00+11:00', '2026-11-08T16:59:00+11:00', '2026-11-09T09:00:00+11:00', '2027-11-06T12:00:00+11:00', '2026-04-05T02:30:00+11:00']) {
    for (const path of ['index.html', 'map.html', 'field.html', 'runner.html', 'index.html?demo=1', 'runner.html?demo=sat09:30', 'field.html?demo=30h&speed=60']) {
      const where = `clock ${iso} ${path}`;
      const { ctx, page, log } = await open(b, null, { phone: /field|runner/.test(path), init: INIT, storage: SEEN, geo: { latitude: -37.14067, longitude: 142.51921, accuracy: 8 } });
      await block(ctx);
      await page.clock.install({ time: new Date(iso) });
      await page.goto(BASE + '' + path, { waitUntil: 'load' }).catch(e => note(where, e.message));
      await page.clock.runFor(4000); await sleep(1200);
      const tabs = await page.evaluate(() => document.querySelectorAll('.rn-nav button, .tab-btn[data-tab]').length);
      for (let i = 0; i < tabs; i++) { await page.evaluate(i => { const b = document.querySelectorAll('.rn-nav button, .tab-btn[data-tab]')[i]; if (b) b.click(); }, i); await page.clock.runFor(1500); await sleep(250); }
      if (/field|runner/.test(path)) { await page.evaluate(() => { const b = document.querySelector('.rn-nav button[data-tab="map"]'); if (b) b.click(); const l = document.querySelector('.rn-locbtn'); if (l) l.click(); }); await page.clock.runFor(3000); await sleep(600); }
      await page.clock.runFor(65000); await sleep(400);  // the once-a-minute refreshes
      drain(log, where);
      await ctx.close();
    }
  }
  await b.close();
  console.log('\n==== ' + issues.length + ' issue(s) ====');
  [...new Set(issues)].forEach(i => console.log('- ' + i.slice(0, 900)));
  process.exit(issues.length ? 1 : 0);
})().catch(e => { console.log('TEST SCRIPT ERROR', e); process.exit(2); });
