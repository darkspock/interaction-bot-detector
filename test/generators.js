// Synthetic trace generators for the tests.
//
// Careful: the "human" here is a model (minimum-jerk profile, curvature,
// overshoot with correction, jitter and 60 Hz sampling), not real data. It
// checks that the analyzer tells the patterns apart, not how accurate it is
// with people. That needs real traces (see the README).

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
const FRAME = 1000 / 60;
const BUTTON = { w: 120, h: 40 };

// Target: a button centred at (cx, cy); the click lands at (x, y).
const target = (cx, cy, x, y) => [{ dx: x - cx, dy: y - cy, w: BUTTON.w, h: BUTTON.h }];

class Trace {
  constructor(start = { x: 50, y: 50 }) {
    this.events = [];
    this.t = 1000;
    this.pos = start;
  }
  move(x, y, dt = FRAME) {
    this.t += dt;
    this.pos = { x, y };
    this.events.push({ type: 'move', t: this.t, x, y, trusted: true });
  }
  click(cx, cy, hold, idle = 0) {
    this.t += idle;
    const { x, y } = this.pos;
    this.events.push({ type: 'down', t: this.t, x, y, trusted: true, button: 0, targets: target(cx, cy, x, y) });
    this.t += hold;
    this.events.push({ type: 'up', t: this.t, x, y, trusted: true, button: 0 });
    this.events.push({ type: 'click', t: this.t, x, y, trusted: true, detail: 1 });
  }
}

const TARGETS = [[460, 320], [900, 180], [220, 560], [700, 640], [1100, 420], [380, 120]];

// Person: minimum-jerk movement with an arc, overshoot, correction and jitter.
export function human(seed = 1, targets = TARGETS) {
  const r = rng(seed);
  const tr = new Trace({ x: 640, y: 400 });
  for (const [cx, cy] of targets) {
    const aim = { x: cx + gauss(r) * BUTTON.w / 7, y: cy + gauss(r) * BUTTON.h / 7 };
    const over = 1.03 + r() * 0.06;
    const peak = { x: tr.pos.x + (aim.x - tr.pos.x) * over, y: tr.pos.y + (aim.y - tr.pos.y) * over };
    humanSegment(tr, r, peak, 0.12);
    humanSegment(tr, r, aim, 0.02);
    tr.click(cx, cy, 70 + r() * 90, 80 + r() * 200);
    // Idle movement while reading.
    for (let i = 0; i < 4 + r() * 6; i++) tr.move(tr.pos.x + gauss(r) * 1.5, tr.pos.y + gauss(r) * 1.5, FRAME * (1 + Math.floor(r() * 3)));
    tr.t += 400 + r() * 1200;
  }
  return tr.events;
}

function humanSegment(tr, r, to, bow) {
  const from = tr.pos;
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  const duration = 120 + 140 * Math.log2(1 + d / 40) + r() * 60;
  const n = Math.max(3, Math.round(duration / FRAME));
  const nx = -(to.y - from.y) / (d || 1), ny = (to.x - from.x) / (d || 1);
  const arc = d * bow * (r() * 2 - 1);
  let drift = { x: 0, y: 0 };
  for (let i = 1; i <= n; i++) {
    const tau = i / n;
    const s = 10 * tau ** 3 - 15 * tau ** 4 + 6 * tau ** 5;
    const b = Math.sin(Math.PI * s) * arc;
    drift = { x: drift.x * 0.6 + gauss(r) * 0.7, y: drift.y * 0.6 + gauss(r) * 0.7 };
    const x = from.x + (to.x - from.x) * s + nx * b + (i < n ? drift.x : 0);
    const y = from.y + (to.y - from.y) * s + ny * b + (i < n ? drift.y : 0);
    tr.move(Math.round(x * 2) / 2, Math.round(y * 2) / 2, FRAME + gauss(r) * 0.4 + (r() < 0.04 ? FRAME : 0));
  }
}

// Playwright/Puppeteer page.click(): jump to the exact centre and a 0.1 ms press.
export function playwrightClick(targets = TARGETS, gapMs = 1500) {
  const tr = new Trace();
  for (const [cx, cy] of targets) {
    tr.t += gapMs;
    tr.move(cx, cy, 0);
    tr.click(cx, cy, 0.1);
  }
  return tr.events;
}

// page.mouse.move(x, y, { steps }) and click: a straight line with identical steps.
export function playwrightSteps(targets = TARGETS, steps = 20) {
  const tr = new Trace();
  for (const [cx, cy] of targets) {
    tr.t += 800;
    const from = tr.pos;
    for (let i = 1; i <= steps; i++) tr.move(from.x + (cx - from.x) * i / steps, from.y + (cy - from.y) * i / steps);
    tr.click(cx, cy, 0.1);
  }
  return tr.events;
}

// "Computer use" agent moving the system mouse (xdotool or similar) to
// coordinates taken from a screenshot: jump, not dead centre, short press.
export function computerUseAgent(seed = 2, targets = TARGETS) {
  const r = rng(seed);
  const tr = new Trace();
  for (const [cx, cy] of targets) {
    tr.t += 3000 + r() * 4000; // "thinking" time
    tr.move(Math.round(cx + (r() - 0.5) * 30), Math.round(cy + (r() - 0.5) * 12), 0);
    tr.click(cx, cy, 2 + r() * 4);
  }
  return tr.events;
}

// "Humanized" bot in the style of ghost-cursor: Bézier curve with easing, a
// human-length press, a random point inside the button.
// With noisePx > 0 it also adds random jitter.
export function bezierHumanizer(seed = 3, { noisePx = 0, targets = TARGETS } = {}) {
  const r = rng(seed);
  const tr = new Trace({ x: 640, y: 400 });
  for (const [cx, cy] of targets) {
    const to = { x: cx + (r() - 0.5) * BUTTON.w * 0.6, y: cy + (r() - 0.5) * BUTTON.h * 0.6 };
    const from = tr.pos;
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    const c1 = { x: from.x + (to.x - from.x) * 0.3 + (r() - 0.5) * d * 0.4, y: from.y + (to.y - from.y) * 0.3 + (r() - 0.5) * d * 0.4 };
    const c2 = { x: from.x + (to.x - from.x) * 0.7 + (r() - 0.5) * d * 0.4, y: from.y + (to.y - from.y) * 0.7 + (r() - 0.5) * d * 0.4 };
    const n = 25 + Math.floor(r() * 15);
    for (let i = 1; i <= n; i++) {
      const tau = i / n;
      const s = tau < 0.5 ? 2 * tau * tau : 1 - (-2 * tau + 2) ** 2 / 2;
      const p = bezier(from, c1, c2, to, s);
      const jitter = i < n ? noisePx : 0;
      tr.move(p.x + gauss(r) * jitter, p.y + gauss(r) * jitter, FRAME);
    }
    tr.click(cx, cy, 60 + r() * 80, 100 + r() * 300);
    tr.t += 500 + r() * 1000;
  }
  return tr.events;
}

function bezier(p0, p1, p2, p3, s) {
  const u = 1 - s;
  return {
    x: u ** 3 * p0.x + 3 * u * u * s * p1.x + 3 * u * s * s * p2.x + s ** 3 * p3.x,
    y: u ** 3 * p0.y + 3 * u * u * s * p1.y + 3 * u * s * s * p2.y + s ** 3 * p3.y,
  };
}

// Script injected into the page that fabricates events with dispatchEvent.
export function jsInjection(targets = TARGETS) {
  return playwrightSteps(targets).map(e => ({ ...e, trusted: false }));
}

// --- Keyboard (timings only, as recorder.js records them) ---

class Keys {
  constructor(t = 50000) { this.events = []; this.t = t; }
  press(hold, gapAfter, typesChar = true) {
    const down = this.t;
    this.events.push({ type: 'keydown', t: down, trusted: true });
    if (typesChar) this.events.push({ type: 'input', t: down + 1, trusted: true, inputType: 'insertText', bulk: false });
    this.events.push({ type: 'keyup', t: down + hold, trusted: true, hold });
    this.t = down + hold + gapAfter;
  }
  bulkInsert(gapAfter = 300) {
    this.events.push({ type: 'input', t: this.t, trusted: true, inputType: 'insertText', bulk: true });
    this.t += gapAfter;
  }
}

// Person typing: keystrokes of tens of milliseconds and an irregular rhythm,
// with the odd Tab between fields.
export function humanTyping(seed = 11, chars = 40) {
  const r = rng(seed);
  const k = new Keys();
  for (let i = 0; i < chars; i++) {
    k.press(55 + r() * 70, 40 + r() * 220);
    if (i % 12 === 11) k.press(70 + r() * 40, 400 + r() * 600, false); // Tab
  }
  k.press(80, 100, false); // Enter
  return k.events;
}

// Playwright keyboard.type(): 0.1-0.3 ms keystrokes and no pauses.
export function playwrightTyping(chars = 40) {
  const k = new Keys();
  for (let i = 0; i < chars; i++) k.press(0.2, 0.3);
  return k.events;
}

// Playwright fill() or an AI agent: text arrives all at once, with no keys, and
// is submitted with instant keystrokes (Space on checkboxes, Enter).
export function fillOnly(fields = 4) {
  const k = new Keys();
  for (let i = 0; i < fields; i++) k.bulkInsert();
  for (let i = 0; i < 3; i++) k.press(0.2, 50, false);
  return k.events;
}

// Person who dictates one field by voice (text at once, no keys) and types the rest.
export function dictationAndTyping(seed = 12) {
  const k = new Keys();
  k.bulkInsert(800);
  k.events.push(...humanTyping(seed, 30).map(e => ({ ...e, t: e.t + 1000 })));
  return k.events;
}

// fill() on several fields and one instant Enter to submit.
export function fillAndOneEnter(fields = 3) {
  const k = new Keys();
  for (let i = 0; i < fields; i++) k.bulkInsert();
  k.press(0.2, 50, false);
  return k.events;
}

// fill() on several fields and a submit from code: no keystroke at all.
export function fillAndScriptSubmit(fields = 3) {
  const k = new Keys();
  for (let i = 0; i < fields; i++) k.bulkInsert();
  return k.events;
}

// Person who moves the mouse normally and dictates the text of each field.
export function dictationWithMouse(seed = 13) {
  const events = human(seed);
  let t = events.at(-1).t;
  for (let i = 0; i < 3; i++) {
    t += 1500;
    events.push({ type: 'input', t, trusted: true, inputType: 'insertText', bulk: true });
  }
  return events;
}

// Person on a phone: taps a field, dictates with the keyboard's microphone,
// taps the next one, and finally taps the submit button.
export function dictationOnPhone() {
  const events = [];
  let t = 1000;
  for (let i = 0; i < 3; i++) {
    events.push({ type: 'touch', t, trusted: true }, { type: 'click', t: t + 80, x: 0, y: 0, trusted: true, detail: 1 });
    events.push({ type: 'input', t: t + 2500, trusted: true, inputType: 'insertText', bulk: true });
    t += 4000;
  }
  events.push({ type: 'touch', t, trusted: true }, { type: 'click', t: t + 80, x: 0, y: 0, trusted: true, detail: 1 });
  return events;
}
