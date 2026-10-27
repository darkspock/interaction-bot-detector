// Trap and server decision in real Chromium driven by Playwright.
//   npm run test:e2e
//
// The demo forms use 'approach' mode: everyone who reaches the button sees a
// notice appear that pushes it down. The default mode ('jump') is tested on a
// minimal page, test/e2e/jump.html.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from '../../scripts/serve.js';

let server, browser, base;

before(async () => {
  server = await serve(0);
  base = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
});

async function open(path, viewport = { width: 1280, height: 1000 }) {
  const page = await browser.newPage({ viewport });
  await page.goto(base + path);
  return page;
}

// Leaves time for a pending submission to finish (the 504 takes 2.5 s).
const state = async page => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !window.formState?.busy, null, { timeout: 8000 });
  return page.evaluate(() => ({
    kinds: window.trap.evidence.map(e => e.kind),
    springs: window.trap.springs,
    received: [...window.received],
    submissions: [...(window.submissions ?? [])],
    modal: document.querySelector('dialog.modal[open] h2')?.textContent ?? null,
    errorPage: document.querySelector('.error-page .error-code')?.textContent ?? null,
    title: document.title,
  }));
};

// What a caught bot sees: the error page of some ordinary server failure,
// with no explanation.
function assertBotError(s) {
  assert.equal(s.submissions.length, 1, JSON.stringify(s.submissions));
  const { status } = s.submissions[0];
  assert.ok([404, 429, 500, 502, 503, 504].includes(status), `status ${status}`);
  assert.equal(s.errorPage, String(status));
  assert.ok(s.title.startsWith(`${status} `), s.title);
}

const blindProof = s => s.kinds.some(k => k === 'decoy-click' || k === 'fast-retarget');

function assertAccepted(s, title) {
  assert.equal(s.submissions.length, 1, JSON.stringify(s.submissions));
  assert.equal(s.submissions[0].status, 200);
  assert.equal(s.modal, title);
  assert.equal(s.errorPage, null);
}

// After falling for the trap, the error page can leave Playwright retrying:
// cut off after 3 s.
const botClick = locator => locator.click({ timeout: 3000 }).catch(() => {});

const center = async (page, selector) => {
  const box = await page.locator(selector).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

async function cdpClick(page, { x, y }) {
  const cdp = await page.context().newCDPSession(page);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
}

// Minimum-jerk movement at 60 Hz with a slight arc, like a hand.
// Every test starts with the cursor away from the buttons.
let cursor;
async function placeCursor(page, at = { x: 640, y: 960 }) {
  cursor = at;
  await page.mouse.move(cursor.x, cursor.y);
}

async function humanMoveTo(page, to, frames = 24) {
  const from = cursor;
  for (let i = 1; i <= frames; i++) {
    const tau = i / frames, s = 10 * tau ** 3 - 15 * tau ** 4 + 6 * tau ** 5;
    const bow = Math.sin(Math.PI * s) * 18;
    await page.mouse.move(from.x + (to.x - from.x) * s + bow, from.y + (to.y - from.y) * s - bow / 2);
    await page.waitForTimeout(16);
  }
  cursor = to;
}

// Human typing: each key is held for tens of milliseconds and the rhythm
// varies. Seeded pseudo-random so the test is repeatable.
let seed = 7;
const rand = (a, b) => { seed = (seed * 1103515245 + 12345) % 2147483648; return a + (seed / 2147483648) * (b - a); };
async function humanPress(page, key) {
  await page.keyboard.down(key);
  await page.waitForTimeout(rand(50, 110));
  await page.keyboard.up(key);
  await page.waitForTimeout(rand(40, 160));
}
async function humanType(page, text) {
  for (const ch of text) await humanPress(page, ch);
}

// The person aims at the button where they see it when they start moving.
async function humanClick(page, selector) {
  const c = await center(page, selector);
  await humanMoveTo(page, { x: c.x + 6, y: c.y + 3 });
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
  await page.waitForTimeout(250);
}

// --- Edit profile ('approach' mode) ---

test('profile · Playwright page.click(): arrives by jump, clicks the old spot and sees the error page', async () => {
  const page = await open('demo/index.html');
  await botClick(page.locator('#save'));
  const s = await state(page);
  assert.ok(blindProof(s), s.kinds.join());
  assert.ok(!s.received.includes('Save changes'));
  assertBotError(s);
  await page.close();
});

test('profile · Playwright clicking every button in a row: same result', async () => {
  const page = await open('demo/index.html');
  for (const b of await page.locator('#profile button').all()) await botClick(b);
  const s = await state(page);
  assert.ok(blindProof(s), s.kinds.join());
  assert.deepEqual(s.received, ['Change photo', 'Preview', 'Cancel']);
  assertBotError(s);
  await page.close();
});

test('profile · agent clicking coordinates: arrives by jump, clicks the old spot and sees the error page', async () => {
  const page = await open('demo/index.html');
  await page.mouse.click(...Object.values(await center(page, '#save')));
  const s = await state(page);
  assert.deepEqual(s.kinds, ['decoy-click']);
  assert.deepEqual(s.received, []);
  assertBotError(s);
  await page.close();
});

test('profile · agent clicking without moving the mouse and repeating from its old screenshot: error page', async () => {
  const page = await open('demo/index.html');
  const old = await center(page, '#save');
  await cdpClick(page, old);
  await page.waitForTimeout(1500);
  await cdpClick(page, old);
  const s = await state(page);
  assert.deepEqual(s.kinds, ['no-move-click', 'decoy-click']);
  assertBotError(s);
  await page.close();
});

test('profile · agent clicking without moving the mouse that looks again: hits the button, but the server answers with an error', async () => {
  const page = await open('demo/index.html');
  await cdpClick(page, await center(page, '#save'));
  let s = await state(page);
  assert.deepEqual(s.kinds, ['no-move-click']);
  assert.equal(s.springs, 1);
  assert.deepEqual(s.submissions, []);
  await page.waitForTimeout(1500);
  await cdpClick(page, await center(page, '#save'));
  s = await state(page);
  assertBotError(s);
  await page.close();
});

test('profile · the notice pushes the button out of its spot and takes its place', async () => {
  const page = await open('demo/index.html');
  await placeCursor(page);
  const before = await page.locator('#save').boundingBox();
  await humanMoveTo(page, await center(page, '#save'));
  const after = await page.locator('#save').boundingBox();
  assert.equal(await page.evaluate(() => window.trap.springs), 1);
  assert.ok(after.y >= before.y + before.height, `the button only moved ${after.y - before.y}px`);
  const atOldSpot = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, { x: before.x + before.width / 2, y: before.y + before.height / 2 });
  assert.equal(atOldSpot, 'late-notice');
  await page.close();
});

test('profile · narrow screen: nothing clickable is ever left where the button was', async () => {
  // With little width the buttons wrap onto two rows and the notice pushes
  // them all down: another button may end up where "Save changes" was.
  for (const viewport of [{ width: 820, height: 600 }, { width: 560, height: 700 }, { width: 1280, height: 1000 }]) {
    const page = await open('demo/index.html', viewport);
    await page.locator('#save').evaluate(el => el.scrollIntoView({ block: 'center' }));
    const before = await page.locator('#save').boundingBox();
    await cdpClick(page, { x: before.x + before.width / 2, y: before.y + before.height / 2 });
    const covered = await page.evaluate(r => {
      const hits = [];
      for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.1, 0.5, 0.9]) {
        const el = document.elementFromPoint(r.x + r.width * fx, r.y + r.height * fy);
        const control = el?.closest('button, a[href], input, select, textarea, label');
        if (control) hits.push(control.textContent.trim() || control.name);
      }
      return hits;
    }, before);
    assert.deepEqual(covered, [], `${viewport.width}x${viewport.height}`);
    // And clicking there activates nothing.
    await page.mouse.click(before.x + before.width / 2, before.y + before.height - 4);
    const s = await state(page);
    assert.deepEqual(s.received, [], `${viewport.width}x${viewport.height}`);
    await page.close();
  }
});

test('profile · person: the button moves down, the first click misses, they aim again and save', async () => {
  const page = await open('demo/index.html');
  await placeCursor(page);
  await humanClick(page, '#save');
  let s = await state(page);
  assert.deepEqual(s.kinds, ['missed-click']);
  assert.deepEqual(s.submissions, []);
  await page.waitForTimeout(400); // sees the notice and looks for the button
  await humanClick(page, '#save');
  s = await state(page);
  assert.deepEqual(s.kinds, ['missed-click'], 'aiming again like a person proves nothing');
  assertAccepted(s, 'Changes saved');
  await page.close();
});

test('profile · person crossing the button quickly on the way down: no false positive', async () => {
  const page = await open('demo/index.html');
  const c = await center(page, '#save');
  await placeCursor(page, { x: c.x, y: c.y - 300 });
  // 40 frames over 560 px: the largest step (~26 px) is smaller than the
  // button's height, so the cursor lands inside, the notice appears and about
  // 50 ms later it also crosses the new position, before anyone can react.
  await humanMoveTo(page, { x: c.x + 10, y: c.y + 260 }, 40);
  assert.equal(await page.evaluate(() => window.trap.springs), 1);
  await page.waitForTimeout(300);
  await humanClick(page, '#save');
  const s = await state(page);
  assert.deepEqual(s.kinds, []);
  assertAccepted(s, 'Changes saved');
  await page.close();
});

test('profile · person using only the keyboard: no notice, no trap, it saves', async () => {
  const page = await open('demo/index.html');
  await page.focus('input[name=title]');
  await page.keyboard.press('End');
  await humanType(page, ' and partner');
  await page.focus('#save');
  await humanPress(page, 'Enter');
  const s = await state(page);
  assert.equal(s.springs, 0);
  assertAccepted(s, 'Changes saved');
  await page.close();
});

test('profile · keyboard-only bot (Playwright keyboard.type): error page', async () => {
  const page = await open('demo/index.html');
  await page.focus('input[name=title]');
  await page.keyboard.type(' and partner');
  await page.focus('#save');
  await page.keyboard.press('Enter');
  assertBotError(await state(page));
  await page.close();
});

test('profile · phone user who only taps: no trap, it saves', async () => {
  const { devices } = await import('playwright');
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  await page.goto(base + 'demo/index.html');
  await page.tap('input[name=notifyMobile]');
  await page.waitForTimeout(400);
  await page.tap('#save');
  const s = await state(page);
  assert.equal(s.springs, 0, 'the trap ignores touch');
  assertAccepted(s, 'Changes saved');
  await context.close();
});

test('profile · bot that fills fields with fill() and presses Enter once: error page', async () => {
  const page = await open('demo/index.html');
  await page.fill('input[name=displayName]', 'Jane Doe');
  await page.fill('input[name=title]', 'Senior associate and partner');
  await page.fill('textarea[name=bio]', 'Civil and commercial litigation.');
  await page.focus('input[name=title]');
  await page.keyboard.press('Enter');
  assertBotError(await state(page));
  await page.close();
});

test('profile · person who dictates the bio by voice, using the mouse: it saves', async () => {
  const page = await open('demo/index.html');
  await placeCursor(page);
  await humanClick(page, 'textarea[name=bio]');
  await page.keyboard.press('End');
  // Dictation inserts whole words at once, with no keystrokes.
  await page.keyboard.insertText(' Frequent speaker at conferences.');
  await page.waitForTimeout(600);
  await humanClick(page, '#save');
  if (!(await state(page)).submissions.length) {
    await page.waitForTimeout(400);
    await humanClick(page, '#save');
  }
  const s = await state(page);
  assertAccepted(s, 'Changes saved');
  await page.close();
});

test('profile · phone user who dictates with the keyboard microphone: it saves', async () => {
  const { devices } = await import('playwright');
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  await page.goto(base + 'demo/index.html');
  await page.tap('input[name=title]');
  await page.keyboard.press('End');
  await page.keyboard.insertText(' and partner');
  await page.waitForTimeout(400);
  await page.tap('#save');
  assertAccepted(await state(page), 'Changes saved');
  await context.close();
});

// --- Sign up ('approach' mode) ---

async function fillSignup(page) {
  await page.fill('input[name=name]', 'Jane Test');
  await page.fill('input[name=email]', 'jane.test@example.com');
  await page.fill('input[name=password]', 'test-password-123');
  await page.selectOption('select[name=country]', 'Spain');
  await page.fill('input[name=birthdate]', '1990-05-17');
  await page.selectOption('select[name=source]', 'Search engine');
}

test('signup · Playwright bot: fills everything, clicks Accept and gets an error', async () => {
  const page = await open('demo/signup.html');
  await fillSignup(page);
  await page.check('input[value=personal]');
  await page.check('input[name=terms]');
  await botClick(page.locator('#accept'));
  const s = await state(page);
  assert.ok(blindProof(s), s.kinds.join());
  assertBotError(s);
  await page.close();
});

test('signup · bot approaching in a straight line and retrying after missing: the server answers with an error', async () => {
  const page = await open('demo/signup.html');
  await fillSignup(page);
  await page.check('input[value=company]');
  await page.check('input[name=terms]');
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = await center(page, '#accept');
    await page.mouse.move(p.x, p.y, { steps: 25 });
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(500);
  }
  const s = await state(page);
  assert.deepEqual(s.kinds, ['missed-click']);
  assertBotError(s);
  await page.close();
});

test('signup · person with mouse and keyboard: misses the first click and the account is created', async () => {
  const page = await open('demo/signup.html');
  await placeCursor(page);
  for (const [selector, text] of [
    ['input[name=name]', 'Jane Test'],
    ['input[name=email]', 'jane.test@example.com'],
    ['input[name=password]', 'test-password-123'],
  ]) {
    await humanClick(page, selector);
    await page.keyboard.type(text, { delay: 40 });
  }
  await humanClick(page, 'select[name=country]');
  await page.selectOption('select[name=country]', 'Portugal');
  await humanClick(page, 'input[name=birthdate]');
  await page.fill('input[name=birthdate]', '1988-11-02');
  await humanClick(page, 'input[value=freelance]');
  await humanClick(page, 'input[name=terms]');
  // If the path between fields already crossed Accept, the notice appeared
  // earlier and the first click hits; otherwise it misses once and aims again.
  await humanClick(page, '#accept');
  if (!(await state(page)).submissions.length) {
    await page.waitForTimeout(400);
    await humanClick(page, '#accept');
  }
  const s = await state(page);
  assert.ok(s.kinds.every(k => k === 'missed-click'), s.kinds.join());
  assertAccepted(s, 'Account created');
  await page.close();
});

test('signup · person using only the keyboard (Enter in a field): the account is created', async () => {
  const page = await open('demo/signup.html');
  for (const [selector, text] of [
    ['input[name=name]', 'Jane Test'],
    ['input[name=email]', 'jane.test@example.com'],
    ['input[name=password]', 'test-password-123'],
    ['input[name=birthdate]', '05171990'],
  ]) {
    await page.focus(selector);
    await humanType(page, text);
  }
  await page.selectOption('select[name=country]', 'Spain');
  await page.focus('input[value=personal]');
  await humanPress(page, 'Space');
  await page.focus('input[name=terms]');
  await humanPress(page, 'Space');
  await page.focus('input[name=name]');
  await humanPress(page, 'Enter');
  const s = await state(page);
  assert.equal(s.springs, 0);
  assertAccepted(s, 'Account created');
  await page.close();
});

test('signup · keyboard-only bot (Playwright keyboard.type): error page', async () => {
  const page = await open('demo/signup.html');
  for (const [selector, text] of [
    ['input[name=name]', 'Jane Test'],
    ['input[name=email]', 'jane.test@example.com'],
    ['input[name=password]', 'test-password-123'],
    ['input[name=birthdate]', '05171990'],
  ]) {
    await page.focus(selector);
    await page.keyboard.type(text);
  }
  await page.selectOption('select[name=country]', 'Spain');
  await page.focus('input[value=personal]');
  await page.keyboard.press('Space');
  await page.focus('input[name=terms]');
  await page.keyboard.press('Space');
  await page.focus('input[name=name]');
  await page.keyboard.press('Enter');
  const s = await state(page);
  assert.equal(s.springs, 0, 'without a mouse the trap does not step in');
  assertBotError(s);
  await page.close();
});

test('signup · bot filling with fill() and submitting with Enter: error page', async () => {
  const page = await open('demo/signup.html');
  await fillSignup(page);
  await page.focus('input[value=personal]');
  await page.keyboard.press('Space');
  await page.focus('input[name=terms]');
  await page.keyboard.press('Space');
  await page.focus('input[name=name]');
  await page.keyboard.press('Enter');
  assertBotError(await state(page));
  await page.close();
});

test('signup · bot that fills with fill() and submits from code, with no keystroke: error page', async () => {
  const page = await open('demo/signup.html');
  await fillSignup(page);
  await page.evaluate(() => {
    document.querySelector('input[value=personal]').checked = true;
    document.querySelector('input[name=terms]').checked = true;
    document.getElementById('signup').requestSubmit();
  });
  assertBotError(await state(page));
  await page.close();
});

test('signup · agent that sets values from code, the way agent form tools do, and presses Enter: error page', async () => {
  const page = await open('demo/signup.html');
  await page.evaluate(() => {
    const set = (selector, value) => {
      const el = document.querySelector(selector);
      if (el.type === 'radio' || el.type === 'checkbox') el.checked = value;
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('input[name=name]', 'Jane Test');
    set('input[name=email]', 'jane.test@example.com');
    set('input[name=password]', 'test-password-123');
    set('select[name=country]', 'Spain');
    set('input[name=birthdate]', '1990-05-17');
    set('input[value=personal]', true);
    set('input[name=terms]', true);
  });
  await page.focus('input[name=name]');
  await page.keyboard.press('Enter');
  assertBotError(await state(page));
  await page.close();
});

// --- 'jump' mode (the library default) ---

test('jump · agent clicking coordinates: the button moves away and it hits the decoy', async () => {
  const page = await open('test/e2e/jump.html');
  await page.mouse.click(...Object.values(await center(page, '#save')));
  const s = await state(page);
  assert.deepEqual(s.kinds, ['decoy-click']);
  assert.deepEqual(s.received, []);
  await page.close();
});

test('jump · person approaching with a path: nothing moves', async () => {
  const page = await open('test/e2e/jump.html');
  await placeCursor(page, { x: 200, y: 500 });
  await humanClick(page, '#save');
  const s = await state(page);
  assert.equal(s.springs, 0);
  assert.deepEqual(s.received, ['Save']);
  await page.close();
});

test('jump · closing a dropdown with the cursor over the button does not trigger the trap', async () => {
  const page = await open('test/e2e/jump.html');
  await placeCursor(page, { x: 200, y: 500 });
  await humanClick(page, 'select[name=timezone]');
  // The native list covered the page: the next move appears suddenly over the button.
  await page.keyboard.press('Escape');
  await page.mouse.move(...Object.values(await center(page, '#save')));
  assert.equal((await state(page)).springs, 0);
  await page.close();
});

test('jump · when it moves away, the button never covers other controls', async () => {
  // Small screen and the button in the corner: it fits neither below nor to the right.
  const page = await open('test/e2e/jump.html', { width: 500, height: 200 });
  await cdpClick(page, await center(page, '#save'));
  const overlaps = await page.evaluate(() => {
    const r = document.getElementById('save').getBoundingClientRect();
    return [...document.querySelectorAll('button, select')]
      .filter(el => el.id !== 'save')
      .filter(el => {
        const q = el.getBoundingClientRect();
        return q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top;
      })
      .map(el => el.textContent.trim() || el.name);
  });
  assert.equal((await state(page)).springs, 1);
  assert.deepEqual(overlaps, []);
  await page.close();
});

test('approach · if another button ends up where the protected one was, a decoy covers it', async () => {
  const page = await open('test/e2e/swap.html');
  const old = await center(page, '#save');
  await page.mouse.click(old.x, old.y); // lands on it, "Save" moves and "Cancel" moves up into its spot
  let s = await state(page);
  assert.deepEqual(s.kinds, ['decoy-click']);
  assert.deepEqual(s.received, [], 'the click must not activate "Cancel"');
  // Once the decoy time is over (1.5 s on this page), "Cancel" works again in
  // its new spot.
  await page.waitForTimeout(1600);
  await page.mouse.click(old.x, old.y);
  s = await state(page);
  assert.deepEqual(s.received, ['Cancel']);
  await page.close();
});
