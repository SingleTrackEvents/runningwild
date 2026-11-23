// Shared by the crash tests: a browser (Playwright's Chromium), and a page that records every error it sees.
// GPT_URL: where the apps are served (default http://127.0.0.1:8765/, which run.js serves itself).
const { chromium, devices } = require('playwright');
const BASE = (process.env.GPT_URL || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const FEEDS = 'http://127.0.0.1:8766/';  // feeds.js, the stand-in tracking and timing provider
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || '';

async function launch() {
  return chromium.launch({ proxy: PROXY ? { server: PROXY, bypass: '127.0.0.1,localhost' } : undefined });
}
// A page with error collection. opts: { phone, width, height, dark, geo: {latitude, longitude, accuracy}, offline, scale }
async function open(browser, path, opts = {}) {
  const phone = opts.phone ? devices['iPhone 13'] : null;
  const ctx = await browser.newContext(Object.assign({},
    phone || { viewport: { width: opts.width || 1366, height: opts.height || 850 } },
    opts.scale && !phone ? { deviceScaleFactor: opts.scale } : {},
    { colorScheme: opts.dark ? 'dark' : 'light', timezoneId: 'Australia/Melbourne', locale: 'en-AU', serviceWorkers: opts.sw ? 'allow' : 'block' },
    opts.geo ? { geolocation: opts.geo, permissions: ['geolocation'] } : {}));
  if (opts.init) await ctx.addInitScript(opts.init);
  if (opts.storage) await ctx.addInitScript(s => { try { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); } catch (e) { } }, opts.storage);
  const page = await ctx.newPage();
  const log = { errors: [], console: [], failed: [], bad: [] };
  page.on('pageerror', e => log.errors.push(String(e && e.stack || e).slice(0, 600)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log.console.push(m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('requestfailed', r => log.failed.push(r.url().slice(0, 160) + ' ' + (r.failure() && r.failure().errorText)));
  page.on('response', r => { if (r.status() >= 400) log.bad.push(r.status() + ' ' + r.url().slice(0, 160)); });
  if (path != null) await page.goto(BASE + path, { waitUntil: 'load', timeout: 60000 });
  return { ctx, page, log };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = { launch, open, sleep, BASE, FEEDS };
