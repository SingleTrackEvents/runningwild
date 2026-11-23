// Crash test: the monkey. Hundreds of random taps, typing, map moves, picker changes, resizes, back and forward on
// each app with the demo race running, from fixed seeds, so anything it breaks can be done again.
//   node tools/crashtest/monkey.js [index,map,field,runner] [steps, default 350] [seeds, default 1,2,3]
const { launch, open, sleep, BASE, FEEDS } = require('./lib');
const issues = [];
const quiet = x => /Service Worker registration blocked|status of 401|ERR_FAILED|ERR_ABORTED|Failed to load resource|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED/.test(x);
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const TEXT = ['', '1010', '87.3', '12,5', 'abc', '#1004', '32:00', '3200', '-1', '99999', '<img src=x onerror=alert(1)>', '///word.word.word', 'smith', '🏃', ' ', '0', '-37.14, 142.52', 'x'.repeat(300)];
const INIT = () => {
  window.__xss = 0; window.alert = () => { window.__xss++; }; window.confirm = () => Math.random() < 0.5; window.prompt = () => null; window.print = () => { };
  window.open = () => null;
  // Links don't leave the page, downloads and shares do nothing.
  document.addEventListener('click', e => { const a = e.target.closest && e.target.closest('a[href]'); if (a) { const h = a.getAttribute('href') || ''; if (!h.startsWith('#')) e.preventDefault(); } }, true);
  try { navigator.share = () => Promise.resolve(); } catch (e) { }
  try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true }); } catch (e) { }
};
const only = (process.argv[2] || 'index,map,field,runner').split(','), N = +(process.argv[3] || 350), SEEDS = (process.argv[4] || '1,2,3').split(',').map(Number);
(async () => {
  const b = await launch();
  for (const app of only) for (const seed of SEEDS) {
    const phone = app === 'field' || app === 'runner' || (app === 'map' && seed % 2 === 0) || (app === 'index' && seed % 3 === 0);
    const where = `${app} seed ${seed}${phone ? ' phone' : ''}`;
    const { ctx, page, log } = await open(b, null, { phone, init: INIT, dark: seed % 2 === 0, storage: { gptIntroSafety: '1', gptIntroMap: '1', gptIntroField: '1', 'rn.introDone': 'true' }, geo: { latitude: -37.14067, longitude: 142.51921, accuracy: 8 } });
    await ctx.route(/workers\.dev/, r => r.abort());
    const url = `${BASE}${app}.html?demo=1&speed=${[1, 10, 60][seed % 3]}`;
    await page.goto(url, { waitUntil: 'load' }); await sleep(2500);
    const R = rng(seed * 7919), trail = [];
    let bad = 0;
    for (let i = 0; i < N && bad < 6; i++) {
      const roll = R();
      let act = '';
      try {
        if (!page.url().startsWith(BASE + app + '.html')) { act = 'left the page (' + page.url().slice(0, 80) + '), going back'; await page.goto(url, { waitUntil: 'load' }); await sleep(1500); }
        else if (roll < 0.62) {
          // tap something that can be tapped
          act = await page.evaluate(r => {
            const els = [...document.querySelectorAll('button, summary, [role=button], label, input[type=checkbox], input[type=radio], .leaflet-marker-icon, .leaflet-interactive, a[href], .tk-who, .row, th')]
              .filter(e => { const b = e.getBoundingClientRect(); if (b.width < 4 || b.height < 4) return false; const x = b.left + b.width / 2, y = b.top + b.height / 2; if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false; const t = document.elementFromPoint(x, y); return t && (t === e || e.contains(t) || t.contains(e)); })
              .filter(e => !/demoExit|demo-exit/.test(e.id + ' ' + e.className) && !/^(Exit|Lock|Refresh now)$/.test((e.textContent || '').trim()));
            if (!els.length) return 'nothing to tap';
            const e = els[Math.floor(r * els.length)];
            const d = (e.tagName + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '') + ' "' + (e.textContent || '').trim().slice(0, 24) + '"');
            e.click ? e.click() : e.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return 'tap ' + d;
          }, R());
        } else if (roll < 0.74) {
          const txt = TEXT[Math.floor(R() * TEXT.length)];
          act = await page.evaluate(([r, txt]) => {
            const els = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), textarea')].filter(e => e.offsetWidth > 0 && !e.disabled && !e.readOnly);
            if (!els.length) return 'no box to type in';
            const e = els[Math.floor(r * els.length)];
            if (e.type === 'time') e.value = '14:30'; else if (e.type === 'number') e.value = String(parseFloat(txt) || 7); else if (e.type === 'date' || e.type === 'datetime-local') return 'date box left alone'; else e.value = txt;
            e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
            const f = e.form; if (f && r > 0.5) f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            return 'type "' + txt.slice(0, 20) + '" in ' + (e.id || e.name || e.type) + (f && r > 0.5 ? ' and submit' : '');
          }, [R(), txt]);
        } else if (roll < 0.80) {
          act = await page.evaluate(r => {
            const els = [...document.querySelectorAll('select')].filter(e => e.offsetWidth > 0 && e.options.length); if (!els.length) return 'no picker';
            const e = els[Math.floor(r * els.length)]; e.selectedIndex = Math.floor(r * 997) % e.options.length; e.dispatchEvent(new Event('change', { bubbles: true })); return 'pick ' + (e.id || 'select') + ' = ' + e.value;
          }, R());
          const sl = await page.evaluate(r => { const els = [...document.querySelectorAll('input[type=range]')].filter(e => e.offsetWidth > 0); if (!els.length) return ''; const e = els[Math.floor(r * els.length)]; e.value = String(+e.min + r * (+e.max - +e.min)); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return ' slider ' + (e.id || ''); }, R());
          act += sl;
        } else if (roll < 0.90) {
          // the map: tap, drag or zoom
          const box = await page.evaluate(() => { const m = [...document.querySelectorAll('.leaflet-container')].find(e => e.offsetWidth > 50); if (!m) return null; const b = m.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
          if (!box) act = 'no map on screen';
          else {
            const x = box.x + box.w * (0.1 + 0.8 * R()), y = Math.min(box.y + box.h * (0.1 + 0.8 * R()), (page.viewportSize() || { height: 800 }).height - 5), k = R();
            if (k < 0.5) { await page.mouse.click(x, y); act = 'map tap'; }
            else if (k < 0.8) { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 120 * (R() - 0.5), y + 120 * (R() - 0.5), { steps: 3 }); await page.mouse.up(); act = 'map drag'; }
            else { await page.mouse.move(x, y); await page.mouse.wheel(0, R() < 0.5 ? -400 : 400); act = 'map zoom'; }
          }
        } else if (roll < 0.94) {
          const vs = phone ? [[390, 664], [664, 390], [360, 560], [430, 860], [820, 1180]] : [[1366, 850], [1024, 700], [760, 900], [1920, 1080], [600, 500]], v = vs[Math.floor(R() * vs.length)];
          await page.setViewportSize({ width: v[0], height: v[1] }); act = 'resize ' + v.join('x');
        } else if (roll < 0.97) { if (R() < 0.6) { await page.goBack({ waitUntil: 'load', timeout: 8000 }).catch(() => { }); act = 'back'; } else { await page.goForward({ waitUntil: 'load', timeout: 8000 }).catch(() => { }); act = 'forward'; } await sleep(300); }
        else if (roll < 0.985) { await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('pageshow')); }); act = 'visibility, offline and online events'; }
        else { await page.reload({ waitUntil: 'load' }); await sleep(1200); act = 'reload'; }
      } catch (e) { act = (act || 'action') + ' failed in the test: ' + String(e.message).split('\n')[0].slice(0, 120); }
      trail.push(act); if (trail.length > 6) trail.shift();
      await sleep(70);
      const errs = log.errors.splice(0).concat(log.console.splice(0).filter(x => !quiet(x) && /error:/.test(x)));
      const xss = await page.evaluate(() => window.__xss).catch(() => 0);
      if (xss) { errs.push('XSS marker fired'); await page.evaluate(() => { window.__xss = 0; }).catch(() => { }); }
      if (errs.length) { bad++; const m = `${where} step ${i}: ${errs[0].slice(0, 500)}\n      after: ${trail.join(' → ')}`; issues.push(m); console.log('  !! ' + m); }
    }
    // Still alive and answering?
    const alive = await page.evaluate(() => ({ ok: !!window.GPT, body: document.body.innerText.length })).catch(e => ({ dead: e.message }));
    if (alive.dead || !alive.ok) { issues.push(where + ': page not answering at the end ' + JSON.stringify(alive)); console.log('  !! ' + where + ' dead at the end'); }
    console.log(`${where}: ${bad} problem step(s)`);
    await ctx.close();
  }
  await b.close();
  console.log('\n==== ' + issues.length + ' issue(s) ====');
  const seen = new Set(); issues.forEach(i => { const k = i.replace(/^.*step \d+: /, '').split('\n')[0].slice(0, 120); if (!seen.has(k)) { seen.add(k); console.log('- ' + i.slice(0, 1200)); } });
  process.exit(issues.length ? 1 : 0);
})().catch(e => { console.log('TEST SCRIPT ERROR', e); process.exit(2); });
