import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, BOT_ERRORS } from '../scripts/serve.js';
import * as gen from './generators.js';

const trapped = [...gen.human(2), { type: 'trap', kind: 'decoy-click', t: 1e9, x: 0, y: 0 }];

test('a person gets the submission confirmed', () => {
  assert.deepEqual(decide(gen.human(2)), { status: 200, body: { ok: true } });
});

test('a person using only the keyboard also gets through', () => {
  assert.equal(decide(gen.humanTyping()).status, 200);
});

test('a submission with no trace or an empty one never went through the page: error', () => {
  for (const trace of [undefined, null, [], 'nothing', {}]) {
    assert.ok(decide(trace).status >= 400, JSON.stringify(trace));
  }
});

test('a trace with no interaction at all (only stray clicks or junk) does not get through either', () => {
  assert.ok(decide([{ type: 'click', t: 1, detail: 1, trusted: true }]).status >= 400);
  assert.ok(decide([null, 3, 'x', { type: 'move' }]).status >= 400);
});

test('a malformed trace does not bring the server down', () => {
  const junk = [null, 7, 'x', { t: 'no' }, { type: 'move', t: NaN }, { type: 'keyup', t: 5, hold: 'long' }];
  assert.doesNotThrow(() => decide(junk));
});

test('a bot gets a server error, and it can be any one in the list', () => {
  const seen = new Set();
  for (let i = 0; i < BOT_ERRORS.length; i++) {
    const out = decide(trapped, () => (i + 0.5) / BOT_ERRORS.length);
    assert.equal(out.body.error.status, out.status);
    seen.add(out.status);
  }
  assert.deepEqual([...seen].sort(), BOT_ERRORS.map(e => e.status).sort());
});

test('the response to a bot does not reveal that it was detected', () => {
  for (const r of [0, 0.5, 0.99]) {
    const text = JSON.stringify(decide(trapped, () => r).body).toLowerCase();
    for (const word of ['bot', 'verdict', 'score', 'trap', 'signal']) assert.ok(!text.includes(word), word);
  }
});

test('bot traces from the generators get an error', () => {
  for (const trace of [gen.playwrightClick(), gen.computerUseAgent(), gen.jsInjection()]) {
    assert.ok(decide(trace).status >= 400);
  }
});

test('real requests to the server: no trace, a null body or broken JSON do not bring it down', async () => {
  const { serve } = await import('../scripts/serve.js');
  const server = await serve(0);
  const url = `http://127.0.0.1:${server.address().port}/api/signup`;
  const post = body => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).then(r => r.status);
  try {
    assert.ok((await post(JSON.stringify({ data: { name: 'Bot' } }))) >= 400, 'no trace');
    assert.ok((await post(JSON.stringify({ data: {}, trace: [] }))) >= 400, 'empty trace');
    assert.ok((await post('null')) >= 400, 'null body');
    assert.equal(await post('{broken'), 400);
    assert.equal(await post(JSON.stringify({ trace: gen.humanTyping() })), 200, 'still alive and accepts a person');
  } finally {
    server.close();
  }
});

test('a phone user who only taps gets through', () => {
  const taps = [
    { type: 'touch', t: 100, trusted: true }, { type: 'click', t: 180, x: 0, y: 0, trusted: true, detail: 1 },
    { type: 'touch', t: 900, trusted: true }, { type: 'click', t: 980, x: 0, y: 0, trusted: true, detail: 1 },
  ];
  assert.equal(decide(taps).status, 200);
});

test('fill() bots get an error; people who dictate get through', () => {
  assert.ok(decide(gen.fillAndOneEnter()).status >= 400);
  assert.ok(decide(gen.fillAndScriptSubmit()).status >= 400);
  for (const trace of [gen.dictationWithMouse(), gen.dictationAndTyping(), gen.dictationOnPhone()]) {
    assert.equal(decide(trace).status, 200);
  }
});
