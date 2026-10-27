import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyzer.js';
import * as gen from './generators.js';

const fired = result => result.signals.filter(s => s.contribution > 0).map(s => s.id);

test('the person model comes out human across 300 seeds', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = analyze(gen.human(seed));
    assert.equal(r.verdict, 'human', `seed ${seed}: ${r.score} ${fired(r)}`);
  }
});

test('Playwright page.click(): jump, dead centre and instant press', () => {
  const r = analyze(gen.playwrightClick());
  assert.equal(r.verdict, 'bot');
  assert.deepEqual(fired(r).sort(), ['dead-center-click', 'instant-release', 'teleport-click']);
});

test('quick successive bot clicks do not merge into a single stroke', () => {
  const r = analyze(gen.playwrightClick(undefined, 60));
  assert.equal(r.verdict, 'bot');
  assert.ok(r.stats.clickKinds.teleport >= 5, JSON.stringify(r.stats.clickKinds));
});

test('mouse.move with steps: perfect line at constant speed', () => {
  const r = analyze(gen.playwrightSteps());
  assert.equal(r.verdict, 'bot');
  for (const id of ['straight-strokes', 'uniform-speed']) assert.ok(fired(r).includes(id), id);
});

test('computer-use agent jumping to coordinates from a screenshot', () => {
  const r = analyze(gen.computerUseAgent());
  assert.equal(r.verdict, 'bot');
  assert.ok(fired(r).includes('teleport-click'));
  assert.ok(!fired(r).includes('dead-center-click'));
});

test('events fabricated with dispatchEvent', () => {
  const r = analyze(gen.jsInjection());
  assert.equal(r.verdict, 'bot');
  assert.ok(fired(r).includes('untrusted-events'));
});

test('known limitation: a bot with Bézier curves and human-length presses is not detected', () => {
  assert.equal(analyze(gen.bezierHumanizer()).verdict, 'human');
  assert.equal(analyze(gen.bezierHumanizer(3, { noisePx: 1.2 })).verdict, 'human');
});

test('too little data: no verdict', () => {
  assert.equal(analyze([]).verdict, 'insufficient-data');
  assert.equal(analyze(gen.human(1).slice(0, 10)).verdict, 'insufficient-data');
});

test('a click without moving the mouse does not count as a jump', () => {
  const events = gen.human(5);
  const before = analyze(events).stats.clickKinds.stationary || 0;
  const lastMove = events.filter(e => e.type === 'move').at(-1);
  const t = lastMove.t + 2000;
  events.push(
    { type: 'down', t, x: lastMove.x + 1, y: lastMove.y, trusted: true, button: 0 },
    { type: 'up', t: t + 90, x: lastMove.x + 1, y: lastMove.y, trusted: true, button: 0 },
  );
  const r = analyze(events);
  assert.equal(r.stats.clickKinds.stationary, before + 1);
  assert.equal(r.verdict, 'human');
});

test('leaving the window and coming back elsewhere is not a jump', () => {
  const events = gen.human(9);
  const lastMove = events.filter(e => e.type === 'move').at(-1);
  events.push({ type: 'leave', t: lastMove.t + 10 });
  for (let i = 0; i < 8; i++) {
    events.push({ type: 'move', t: lastMove.t + 500 + i * 16.7, x: 10 + i * 6, y: 700 - i * 3 + (i % 2), trusted: true });
  }
  const r = analyze(events);
  assert.equal(r.signals.find(s => s.id === 'teleport-move').contribution, 0);
});

test('keyboard activation (click with detail 0) is not a programmatic click', () => {
  const events = gen.human(3);
  events.push({ type: 'click', t: events.at(-1).t + 3000, x: 0, y: 0, trusted: true, detail: 0 });
  assert.equal(analyze(events).signals.find(s => s.id === 'programmatic-click').contribution, 0);
});

test('the order of the input events does not matter', () => {
  const events = gen.playwrightSteps();
  const shuffled = [...events].reverse();
  assert.deepEqual(analyze(shuffled), analyze(events));
});

test('real trace: Claude clicking the demo from the app\'s built-in browser', async () => {
  const { readFile } = await import('node:fs/promises');
  const events = JSON.parse(await readFile(new URL('./fixtures/claude-in-app-browser.json', import.meta.url)));
  const r = analyze(events);
  assert.equal(r.verdict, 'bot');
  assert.equal(r.stats.moves, 0);
});

test('real trace: a person moving the mouse around the demo', async () => {
  const { readFile } = await import('node:fs/promises');
  const events = JSON.parse(await readFile(new URL('./fixtures/human-mouse-real.json', import.meta.url)));
  const r = analyze(events);
  assert.equal(r.verdict, 'human', JSON.stringify(r.signals.filter(s => s.contribution > 0)));
  assert.equal(r.score, 0);
});

test('trap proofs are enough for a bot verdict', () => {
  for (const kind of ['decoy-click', 'fast-retarget']) {
    const events = [...gen.human(4), { type: 'trap', kind, t: 1e9, x: 0, y: 0 }];
    const r = analyze(events);
    assert.equal(r.verdict, 'bot', kind);
    assert.equal(r.signals.find(s => s.id === 'trap-hit').contribution, 0.95);
  }
});

test('the trap\'s no-move-click is not counted twice', () => {
  const events = [...gen.human(4), { type: 'trap', kind: 'no-move-click', t: 1e9, x: 0, y: 0 }];
  assert.equal(analyze(events).verdict, 'human');
});

test('clicking where the button was in approach mode (missed-click) is not bot proof', () => {
  const events = [...gen.human(4), { type: 'trap', kind: 'missed-click', t: 1e9, x: 0, y: 0 }];
  const r = analyze(events);
  assert.equal(r.verdict, 'human');
  assert.equal(r.signals.find(s => s.id === 'trap-hit').contribution, 0);
});

test('keyboard · person using only the keyboard: human', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const r = analyze(gen.humanTyping(seed));
    assert.equal(r.verdict, 'human', `seed ${seed}: ${r.score} ${fired(r)}`);
  }
});

test('keyboard · Playwright keyboard.type(): bot', () => {
  const r = analyze(gen.playwrightTyping());
  assert.equal(r.verdict, 'bot');
  for (const id of ['instant-keys', 'machine-typing']) assert.ok(fired(r).includes(id), id);
});

test('keyboard · text all at once with no keys, submitted with instant keystrokes: bot', () => {
  const r = analyze(gen.fillOnly());
  assert.equal(r.verdict, 'bot', `${r.score} ${fired(r)}`);
  assert.ok(fired(r).includes('keyless-text'));
});

test('keyboard · dictating one field by voice is not enough to flag a person', () => {
  const r = analyze(gen.dictationAndTyping());
  assert.notEqual(r.verdict, 'bot', `${r.score} ${fired(r)}`);
  assert.ok(fired(r).includes('keyless-text'));
});

test('keyboard · the analysis does not need to know which keys were pressed', () => {
  for (const e of gen.humanTyping()) assert.ok(!('key' in e) && !('code' in e) && !('data' in e));
});

test('touch · a tap is a real press: the click after it is not programmatic', () => {
  const events = [
    { type: 'touch', t: 100, trusted: true },
    { type: 'click', t: 180, x: 10, y: 10, trusted: true, detail: 1 },
  ];
  const r = analyze(events);
  assert.equal(r.signals.find(s => s.id === 'programmatic-click').contribution, 0);
  assert.equal(r.stats.touches, 1);
  assert.equal(r.verdict, 'insufficient-data');
});

test('keyboard · fill() and a single instant Enter: bot', () => {
  const r = analyze(gen.fillAndOneEnter());
  assert.equal(r.verdict, 'bot', `${r.score} ${fired(r)}`);
  assert.ok(fired(r).includes('machine-fill'));
});

test('keyboard · fill() submitted from code, with no keystroke at all: bot', () => {
  for (const fields of [1, 3]) {
    const r = analyze(gen.fillAndScriptSubmit(fields));
    assert.equal(r.verdict, 'bot', `${fields} fields: ${r.score} ${fired(r)}`);
  }
});

test('keyboard · dictating fields is not punished when anything else in the visit looks human', () => {
  for (const [name, trace] of [
    ['with mouse', gen.dictationWithMouse()],
    ['with keyboard', gen.dictationAndTyping()],
    ['on a phone', gen.dictationOnPhone()],
  ]) {
    const r = analyze(trace);
    assert.ok(!fired(r).includes('machine-fill'), name);
    assert.notEqual(r.verdict, 'bot', `${name}: ${r.score} ${fired(r)}`);
  }
});

test('keyboard · values set by a script (agent form tools) and one instant Enter: bot', () => {
  const events = [1000, 1400, 1800].map(t => ({ type: 'input', t, trusted: false, inputType: null, bulk: true }));
  events.push(
    { type: 'keydown', t: 2500, trusted: true },
    { type: 'keyup', t: 2500.3, trusted: true, hold: 0.3 },
  );
  const r = analyze(events);
  assert.equal(r.verdict, 'bot', `${r.score} ${fired(r)}`);
  assert.ok(fired(r).includes('machine-fill'));
  assert.ok(!fired(r).includes('untrusted-events'), 'a script-set value is keyless text, not a fabricated mouse event');
});

test('keyboard · a page filling fields in reaction to a click ("copy my address") does not count', () => {
  const events = gen.human(6);
  const down = events.filter(e => e.type === 'down').at(-1);
  for (let i = 0; i < 4; i++) events.push({ type: 'input', t: down.t + 5 + i, trusted: false, inputType: null, bulk: true });
  const r = analyze(events);
  assert.equal(r.stats.keylessInputs, 0);
  assert.equal(r.verdict, 'human');
});
