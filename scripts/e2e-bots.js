// End-to-end comparison: opens the demo in real Chromium, drives it with
// several automation strategies and prints what the detector says about each.
//   node scripts/e2e-bots.js
import { chromium } from 'playwright';
import { serve } from './serve.js';

const server = await serve(0);
const url = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch();

const rand = (a, b) => a + Math.random() * (b - a);

async function bezierTo(page, from, to, { noise = 0 } = {}) {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  const c1 = { x: from.x + (to.x - from.x) * 0.3 + rand(-0.2, 0.2) * d, y: from.y + (to.y - from.y) * 0.3 + rand(-0.2, 0.2) * d };
  const c2 = { x: from.x + (to.x - from.x) * 0.7 + rand(-0.2, 0.2) * d, y: from.y + (to.y - from.y) * 0.7 + rand(-0.2, 0.2) * d };
  const n = 30;
  for (let i = 1; i <= n; i++) {
    const tau = i / n, s = tau < 0.5 ? 2 * tau * tau : 1 - (-2 * tau + 2) ** 2 / 2, u = 1 - s;
    const x = u ** 3 * from.x + 3 * u * u * s * c1.x + 3 * u * s * s * c2.x + s ** 3 * to.x;
    const y = u ** 3 * from.y + 3 * u * u * s * c1.y + 3 * u * s * s * c2.y + s ** 3 * to.y;
    const j = i < n ? noise : 0;
    await page.mouse.move(x + rand(-j, j), y + rand(-j, j));
    await page.waitForTimeout(16);
  }
}

async function humanizedBezier(page, noise) {
  let pos = { x: 640, y: 400 };
  await page.mouse.move(pos.x, pos.y);
  for (const b of await page.locator('#profile button').all()) {
    const box = await b.boundingBox();
    const to = { x: box.x + rand(10, box.width - 10), y: box.y + rand(8, box.height - 8) };
    await bezierTo(page, pos, to, { noise });
    pos = to;
    await page.mouse.down(); await page.waitForTimeout(rand(60, 140)); await page.mouse.up();
    await page.waitForTimeout(rand(200, 600));
  }
}

const strategies = {
  'page.click()': async page => {
    // After falling for the trap, the error page leaves Playwright retrying: cut off after 3 s.
    for (const b of await page.locator('#profile button').all()) await b.click({ timeout: 3000 }).catch(() => {});
  },
  'mouse.move(steps:25) + click': async page => {
    for (const b of await page.locator('#profile button').all()) {
      const box = await b.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
      await page.mouse.down(); await page.mouse.up();
    }
  },
  'agent clicking coordinates (jump + click)': async page => {
    for (const b of await page.locator('#profile button').all()) {
      const box = await b.boundingBox();
      await page.waitForTimeout(rand(200, 600));
      await page.mouse.click(box.x + rand(10, box.width - 10), box.y + rand(8, box.height - 8), { delay: rand(1, 5) });
    }
  },
  'humanized Bézier': page => humanizedBezier(page, 0),
  'humanized Bézier + jitter': page => humanizedBezier(page, 1.5),
  'injected script (dispatchEvent)': async page => {
    await page.evaluate(async () => {
      for (const b of document.querySelectorAll('#profile button')) {
        const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        for (let i = 0; i < 20; i++) dispatchEvent(new MouseEvent('mousemove', { clientX: x - 100 + i * 5, clientY: y, bubbles: true }));
        for (const type of ['mousedown', 'mouseup']) b.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
        b.click();
      }
    });
  },
  'keyboard only: keyboard.type()': async page => {
    await page.focus('input[name=title]');
    await page.keyboard.type(' and partner');
    await page.focus('textarea[name=bio]');
    await page.keyboard.type(' Frequent speaker at conferences.');
  },
  'fill() + one Enter': async page => {
    await page.fill('input[name=displayName]', 'Jane Doe');
    await page.fill('input[name=title]', 'Senior associate and partner');
    await page.fill('textarea[name=bio]', 'Civil and commercial litigation.');
    await page.focus('input[name=title]');
    await page.keyboard.press('Enter');
  },
};

console.log('strategy'.padEnd(42), 'verdict'.padEnd(18), 'score'.padEnd(7), 'signals');
for (const [name, run] of Object.entries(strategies)) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(url);
  await run(page);
  const r = await page.evaluate(() => window.detector.analyze());
  const on = r.signals.filter(s => s.contribution > 0).map(s => `${s.id}=${s.contribution}`).join(' ');
  console.log(name.padEnd(42), r.verdict.padEnd(18), String(r.score).padEnd(7), on);
  await page.close();
}

await browser.close();
server.close();
