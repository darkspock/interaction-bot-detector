// Probe: logs mouse events exactly as the page receives them when Playwright
// (CDP) generates them. Used to set thresholds with real data.
import { chromium } from 'playwright';

const html = `<!doctype html><body style="margin:0;height:900px">
<button id="b" style="position:absolute;left:400px;top:300px;width:120px;height:40px">OK</button>
<script>
window.log = [];
for (const type of ['mousemove','mousedown','mouseup','click','pointermove','pointerdown']) {
  addEventListener(type, e => log.push({type, t: +e.timeStamp.toFixed(3), x: e.clientX, y: e.clientY,
    mx: e.movementX, my: e.movementY, trusted: e.isTrusted, detail: e.detail, pt: e.pointerType,
    coalesced: e.getCoalescedEvents ? e.getCoalescedEvents().length : null}), true);
}
</script></body>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);
const dump = async label => {
  const log = await page.evaluate(() => { const l = window.log; window.log = []; return l; });
  console.log('\n## ' + label);
  for (const e of log) console.log(JSON.stringify(e));
};
await page.mouse.move(100, 100); await dump('mouse.move(100,100) — jump');
await page.mouse.move(300, 200, { steps: 8 }); await dump('mouse.move steps:8');
await page.click('#b'); await dump('page.click(#b)');
for (let i = 0; i < 5; i++) { await page.mouse.move(300 + i * 13.37, 200 + i * 7.1); await page.waitForTimeout(16); }
await dump('moves 16 ms apart with fractional coordinates');
await page.mouse.down(); await page.waitForTimeout(90); await page.mouse.up(); await dump('down/up 90 ms apart');
await browser.close();
