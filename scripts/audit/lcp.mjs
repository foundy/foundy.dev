// Real-browser LCP/CLS/long-task observation (no Lighthouse model): usage: node scripts/audit/lcp.mjs <url> [cpuSlowdown=4]
import { chromium } from 'playwright';

const [url, slow = '4'] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(slow) });
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
await p.addInitScript(() => {
  window.__lcp = [];
  window.__cls = 0;
  window.__long = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lcp.push([Math.round(e.startTime), e.element?.className || e.element?.tagName, e.size]))).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (window.__cls += e.value))).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true });
});
await p.goto(url, { waitUntil: 'load' });
await p.waitForTimeout(6000);
console.log(JSON.stringify(await p.evaluate(() => ({ lcp: window.__lcp, cls: +window.__cls.toFixed(4), long: window.__long, fcp: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime) }))));
await b.close();
