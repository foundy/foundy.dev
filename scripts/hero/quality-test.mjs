// Synthetic check of the adaptive quality controller (pure logic, no browser): node scripts/hero/quality-test.mjs
import { createQuality } from '../../src/lib/core/quality.ts';

let fails = 0;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

function feed(q, ms, seconds, t0 = 0, jitter = () => 0) {
  let t = t0;
  while (t - t0 < seconds * 1000) {
    const iv = ms + jitter();
    t += iv;
    q.push(iv, t);
  }
  return t;
}

{
  const q = createQuality();
  feed(q, 16.7, 7);
  expect('clean 60 Hz for 7 s stays mid (no upgrade before 8 s clean)', q.tier, 'mid');
}
{
  const q = createQuality();
  const changes = [];
  const q2 = createQuality({ onChange: (t, r) => changes.push([t, r]) });
  feed(q2, 16.7, 20);
  expect('clean 60 Hz for 20 s upgrades to high', q2.tier, 'high');
  void q;
}
{
  const changes = [];
  const q = createQuality({ onChange: (t, r) => changes.push([t, r]) });
  feed(q, 40, 3); // 25 fps: p90 40 ms
  expect('sustained 40 ms frames downgrade mid -> low', q.tier, 'low');
  const t = feed(q, 16.7, 60, 5000);
  expect('never upgrades back to a tier it downgraded from', q.tier, 'low');
  void t;
}
{
  const q = createQuality();
  let i = 0;
  feed(q, 16.7, 4, 0, () => (++i % 20 === 0 ? 17 : 0)); // 5% of frames miss one vsync: p90 stays 16.7
  expect('5% single missed vsyncs do not downgrade', q.tier, 'mid');
}
{
  const q = createQuality();
  let i = 0;
  feed(q, 16.7, 3, 0, () => (++i % 5 === 0 ? 33 : 0)); // 20% of frames at ~50 ms
  expect('20% long frames downgrade', q.tier, 'low');
}
{
  const q = createQuality();
  feed(q, 8.3, 3); // 120 Hz display, running at 120 fps: fine
  expect('120 Hz at full rate stays mid', q.tier, 'mid');
  const q2 = createQuality();
  let i = 0;
  feed(q2, 8.3, 3, 0, () => (++i % 3 === 0 ? 8.3 : 0)); // 120 Hz panel dropping to 60 on a third: p90 = 16.6 > 12
  expect('120 Hz panel missing frames (p90 > 12 ms) downgrades', q2.tier, 'low');
}
{
  const q = createQuality({ start: 'high', pinned: true });
  feed(q, 60, 5);
  expect('pinned tier never adapts', q.tier, 'high');
}
process.exit(fails ? 1 : 0);
