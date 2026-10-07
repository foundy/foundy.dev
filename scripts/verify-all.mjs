// `npm run verify`: fresh build -> astro preview on a free port -> every verify script x every browser, sequentially.
// usage: node scripts/verify-all.mjs [--no-build] [--browsers=chromium,webkit,firefox] [--only=hero,inspect,cards,lab,audit]
// Exits non-zero if the build or any script fails. Servers are always stopped.
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const browsers = arg('browsers', 'chromium,webkit,firefox').split(',');
const only = arg('only', 'hero,inspect,cards,lab,audit').split(',');
const skipBuild = process.argv.includes('--no-build');

if (!skipBuild) {
  const b = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
  if (b.status !== 0) process.exit(b.status ?? 1);
}

const port = await new Promise((res) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => res(p));
  });
});
const base = `http://127.0.0.1:${port}`;
// astro 7 preview daemonizes itself when stdout is not a TTY and prints its pid: capture it and kill that.
const server = spawn(process.execPath, ['node_modules/astro/bin/astro.mjs', 'preview', '--ignore-lock', '--host', '127.0.0.1', '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'ignore'],
});
let serverPid = server.pid;
server.stdout.on('data', (d) => {
  const m = /pid (\d+)/.exec(String(d));
  if (m) serverPid = Number(m[1]);
});
let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  for (const pid of new Set([serverPid, server.pid])) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }
};
process.on('exit', stop);
process.on('SIGINT', () => process.exit(130));

for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(base + '/')).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const rows = [];
for (const name of only.filter((n) => n !== 'audit')) {
  for (const br of browsers) {
    const r = spawnSync('node', [`scripts/${name}/verify.mjs`, base, br], { encoding: 'utf8', maxBuffer: 1 << 26 });
    const lines = (r.stdout ?? '').split('\n').filter((l) => l.startsWith('{'));
    const checks = lines
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((c) => c && 'ok' in c);
    const fail = checks.filter((c) => !c.ok);
    const ok = r.status === 0 && fail.length === 0;
    rows.push({ name, br, ok, total: checks.length, failed: fail.length });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} / ${br}: ${checks.length - fail.length}/${checks.length}`);
    for (const f of fail.slice(0, 8)) console.log('   x', f.name);
    if (!ok && r.stderr) console.log(r.stderr.split('\n').slice(0, 6).join('\n'));
  }
}
// audits: exit-code based (no per-check JSON). keyboard + axe run in every browser, chart labels once.
const audits = [
  ['lab-chart-labels', 'scripts/lab/charts.mjs', ['chromium']],
  ['keyboard+zoom', 'scripts/audit/keyboard.mjs', browsers],
  ['axe', 'scripts/audit/a11y.mjs', browsers],
].filter(() => only.includes('audit'));
for (const [name, script, brs] of audits) {
  for (const br of brs) {
    const r = spawnSync('node', [script, base, br], { encoding: 'utf8', maxBuffer: 1 << 26 });
    const ok = r.status === 0;
    rows.push({ name, br, ok, total: 1, failed: ok ? 0 : 1 });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} / ${br}`);
    if (!ok) console.log((r.stdout ?? '').split('\n').filter((l) => /FAIL|VIOLATION|overlap/i.test(l)).slice(0, 8).join('\n'));
  }
}
stop();
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length}/${rows.length} suites passed`);
process.exit(bad.length ? 1 : 0);
