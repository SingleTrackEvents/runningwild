#!/usr/bin/env node
// Run every crash test against this checkout: node tools/crashtest/run.js   (about an hour and a half; README.md beside this file)
// It serves the apps itself on http://127.0.0.1:8765/, the stand-in feeds on :8766 and the Worker's stand-in on :8787,
// runs each test in turn, and ends with the list of problems found (and a non-zero exit code if there are any).
//   node tools/crashtest/run.js quick     the short set (about 25 minutes): inputs for each app, the feeds, no signal
//   node tools/crashtest/run.js only inputs.js runner     one test (here the runner app's inputs)
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '../..'), HERE = __dirname;
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', webmanifest: 'application/manifest+json', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml', woff2: 'font/woff2', md: 'text/plain; charset=utf-8', txt: 'text/plain' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (err, buf) => { if (err) { res.writeHead(404); res.end('not found'); return; } res.writeHead(200, { 'Content-Type': TYPES[path.extname(f).slice(1)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(buf); });
});
const quick = process.argv[2] === 'quick';
// The Worker's stand-in (worker-local.mjs) keeps its database with Node's own SQLite, which came in Node 22.5.
const [NMAJ, NMIN] = process.versions.node.split('.').map(Number), HAS_WORKER = NMAJ > 22 || (NMAJ === 22 && NMIN >= 5);
const TESTS = process.argv[2] === 'only' ? [process.argv.slice(3)] : [
  ['inputs.js', 'staff'], ['inputs.js', 'map'], ['inputs.js', 'field'], ['inputs.js', 'runner'], ['feeds-gps-clock.js', 'feeds'], ['offline.js'],
  ['live.js', 'demo'], ...(HAS_WORKER ? [['worker-test.mjs'], ['live.js', 'worker']] : []),
  ...(quick ? [] : [['inputs.js', 'storage'], ['feeds-gps-clock.js', 'gps'], ['feeds-gps-clock.js', 'clock'], ['monkey.js']])
];
const run = (file, args) => new Promise(done => {
  const out = [], c = spawn(process.execPath, [path.join(HERE, file), ...args], { env: Object.assign({}, process.env, { GPT_URL: 'http://127.0.0.1:8765/', RC_PASSWORD: 'local-test' }) });
  c.stdout.on('data', d => { process.stdout.write(d); out.push(String(d)); }); c.stderr.on('data', d => process.stderr.write(d));
  c.on('close', code => done({ code, text: out.join('') }));
});
server.listen(8765, '127.0.0.1', async () => {
  const feeds = spawn(process.execPath, [path.join(HERE, 'feeds.js')], { stdio: 'ignore' });
  // The Worker itself, on this computer, with a made-up password (nothing here needs the real one).
  const wk = HAS_WORKER ? spawn(process.execPath, [path.join(HERE, 'worker-local.mjs')], { stdio: 'ignore', env: Object.assign({}, process.env, { RC_PASSWORD: 'local-test' }) }) : null;
  if (!HAS_WORKER) console.log('Node ' + process.versions.node + ': the tests that run the Worker on this computer need Node 22.5 or later, so they are left out.');
  await new Promise(r => setTimeout(r, 2000));
  const found = [];
  for (const [file, ...args] of TESTS) {
    console.log(`\n######## ${file} ${args.join(' ')}`);
    const r = await run(file, args);
    if (r.code === 2) found.push(`${file} ${args.join(' ')}: the test script itself failed (see above)`);
    r.text.split('\n').filter(l => l.startsWith('- ')).forEach(l => found.push(`${file} ${args.join(' ')} ${l}`));
    r.text.split('\n').filter(l => l.startsWith('  FAIL ') && file === 'worker-test.mjs').forEach(l => found.push(`${file} - ${l.trim()}`));
  }
  feeds.kill(); if (wk) wk.kill(); server.close();
  console.log(`\n================ ${found.length ? found.length + ' problem(s) found' : 'No problems found'} ================`);
  [...new Set(found)].forEach(l => console.log(l.slice(0, 700)));
  process.exit(found.length ? 1 : 0);
});
