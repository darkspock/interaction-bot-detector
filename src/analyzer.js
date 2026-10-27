// Pure analyzer: takes a list of normalized mouse and keyboard events and
// returns a verdict with the signals behind it. It never touches the DOM, so it
// runs in the browser or on the server (recommended: anything that runs on the
// client can be tampered with by the bot itself).
//
// Event format (produced by recorder.js):
//   { type: 'move' | 'down' | 'up' | 'click' | 'leave' | 'trap',
//     t: ms, x, y, trusted: boolean, button?, detail?,
//     targets?: [{ dx, dy, w, h }]   // 'down' only: offset from the centre of the
//   }                                 // pressed element and of its ancestors
// 'trap' events are added by trap.js: { type: 'trap', kind, t, x, y }.
// Keyboard, without which key or which text:
//   { type: 'keydown', t, trusted }   { type: 'keyup', t, trusted, hold: ms | null }
//   { type: 'input', t, trusted, inputType, bulk }  // bulk: more than one character at once;
//                                                   // trusted false: a script set the value
// Touch and pen presses carry only their time: { type: 'touch', t, trusted }.

export const DEFAULTS = {
  strokeGapMs: 120,        // a longer pause splits two strokes
  restPx: 3,               // a click closer than this to the last position is "without moving"
  teleportPx: 40,          // a first stroke step longer than this is a jump
  instantReleaseMs: 10,    // holding the button for less than this is an instant press
  centerTolerancePx: 0.75, // closer than this to the exact centre is a "dead-centre click"
  centerMinW: 20,
  centerMinH: 14,
  minStrokeChordPx: 80,    // shorter strokes are not analysed for shape
  minStrokeSteps: 5,
  straightMaxDevPx: 0.5,   // maximum deviation from the chord for a "perfect line"
  uniformCvLow: 0.12,      // step-length variation: below this, suspicious
  uniformCvHigh: 0.25,     // above this, normal
  botThreshold: 0.7,
  humanThreshold: 0.3,
  minMovesForHuman: 30,
  minStrokesForHuman: 3,
  instantKeyMs: 10,        // a key released sooner than this is a machine keystroke
  keyBurstGapMs: 1000,     // longer pauses split typing bursts
  machineKeyLowMs: 15,     // median gap between keys: below this, machine
  machineKeyHighMs: 40,    // above this, normal
  keylessWindowMs: 100,    // text arriving with no key pressed within this window
  humanKeyMs: 30,          // a key held at least this long looks like a finger
  minKeysForHuman: 20,     // keystrokes needed to say "human" from the keyboard alone
};

const SIGNALS = {
  'trap-hit': { weight: 0.95, label: 'Fell for the trap: clicked the decoy or chased the button at inhuman speed' },
  'untrusted-events': { weight: 0.95, label: 'Synthetic events created by JavaScript (isTrusted = false)' },
  'programmatic-click': { weight: 0.6, label: 'Clicks with no mouse press before them' },
  'teleport-click': { weight: 0.9, label: 'Clicks reached by a cursor jump, with no path' },
  'instant-release': { weight: 0.6, label: 'Mouse button released instantly' },
  'dead-center-click': { weight: 0.55, label: 'Clicks on the exact geometric centre of the element' },
  'teleport-move': { weight: 0.5, label: 'Cursor jumps with no intermediate path' },
  'straight-strokes': { weight: 0.7, label: 'Perfectly straight strokes' },
  'uniform-speed': { weight: 0.6, label: 'Constant-speed strokes (identical steps)' },
  'instant-keys': { weight: 0.7, label: 'Keys released instantly' },
  'machine-typing': { weight: 0.6, label: 'Typing at machine speed' },
  'keyless-text': { weight: 0.5, label: 'Text that appears all at once with no key pressed' },
  'machine-fill': { weight: 0.9, label: 'Fields filled without typing, with nothing else in the visit that looks human' },
};

export function analyze(events, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const st = segment(sorted, o);
  const signals = buildSignals(st, o);
  const score = 1 - signals.reduce((acc, s) => acc * (1 - s.contribution), 1);
  return {
    verdict: verdictFor(score, st, o),
    score: round(score),
    signals,
    stats: {
      moves: st.moves,
      strokes: st.strokes.length,
      shapeStrokes: st.strokes.filter(s => s.eligible).length,
      clicks: st.clicks.length,
      clickKinds: countBy(st.clicks, c => c.kind),
      holds: st.holds.map(round),
      keys: st.keyHolds.length,
      keylessInputs: st.keyless,
      touches: st.touches,
    },
  };
}

// Walks the events, groups them into strokes and classifies each click.
function segment(events, o) {
  const st = {
    moves: 0, untrusted: 0, programmaticClicks: 0, teleportMoves: 0,
    strokes: [], clicks: [], holds: [], centerHits: 0, centerEligible: 0, trapHits: 0,
    keyDowns: [], keyHolds: [], keyless: 0, touches: 0,
  };
  let last = null;    // last known cursor position
  let stroke = null;  // stroke in progress
  let lastDown = null;
  let lastTrustedDownT = -Infinity;
  let lastUserActionT = -Infinity; // last real keystroke, mouse press or tap

  const closeStroke = () => {
    if (!stroke) return;
    const s = describeStroke(stroke, o);
    st.strokes.push(s);
    if (stroke.origin && stroke.moves <= 2 && stroke.firstStep > o.teleportPx && !stroke.hadDown) {
      st.teleportMoves++;
    }
    stroke = null;
  };

  for (const e of events) {
    if (e.type === 'input') {
      // Several characters at once with no key pressed just before: a program
      // filling the field. Pasting or autocompleting have another inputType.
      // An input event created by a script means the value was set by code;
      // it only counts if no user action came just before, because pages
      // legitimately fill fields in reaction to a click ("copy my address").
      const quiet = e.t - lastUserActionT > o.keylessWindowMs;
      if (e.trusted === false ? quiet : e.inputType === 'insertText' && e.bulk && quiet) st.keyless++;
      continue;
    }

    if (e.trusted === false && e.type !== 'click') { st.untrusted++; continue; }

    if (e.type === 'leave') { closeStroke(); last = null; continue; }

    // A tap is a real press: the click that follows it is not programmatic.
    if (e.type === 'touch') { st.touches++; lastTrustedDownT = lastUserActionT = e.t; continue; }

    if (e.type === 'keydown') { st.keyDowns.push(e.t); lastUserActionT = e.t; continue; }
    if (e.type === 'keyup') { if (Number.isFinite(e.hold)) st.keyHolds.push(e.hold); continue; }

    if (e.type === 'trap') {
      // no-move-click is already covered by teleport-click, and people who click
      // in a hurry also produce missed-click; only bots produce these two.
      if (e.kind === 'decoy-click' || e.kind === 'fast-retarget') st.trapHits++;
      continue;
    }

    if (e.type === 'move') {
      st.moves++;
      const p = { x: e.x, y: e.y, t: e.t };
      if (stroke && p.t - stroke.lastT <= o.strokeGapMs) {
        stroke.points.push(p);
        stroke.moves++;
      } else {
        closeStroke();
        stroke = {
          origin: last,
          points: last ? [last, p] : [p],
          moves: 1,
          firstStep: last ? dist(last, p) : 0,
          hadDown: false,
        };
      }
      stroke.lastT = p.t;
      last = p;
      continue;
    }

    if (e.type === 'down') {
      lastTrustedDownT = lastUserActionT = e.t;
      lastDown = e;
      const active = stroke && e.t - stroke.lastT <= o.strokeGapMs;
      st.clicks.push({ t: e.t, kind: classifyClick(e, active ? stroke : null, last, o) });
      if (active) stroke.hadDown = true;
      if (e.targets) {
        const big = e.targets.filter(r => r.w >= o.centerMinW && r.h >= o.centerMinH);
        if (big.length) {
          st.centerEligible++;
          if (big.some(r => Math.abs(r.dx) <= o.centerTolerancePx && Math.abs(r.dy) <= o.centerTolerancePx)) {
            st.centerHits++;
          }
        }
      }
      last = { x: e.x, y: e.y, t: e.t };
      continue;
    }

    if (e.type === 'up') {
      if (lastDown && lastDown.button === e.button) st.holds.push(e.t - lastDown.t);
      lastDown = null;
      // Releasing closes the stroke: the next move starts from here even if it
      // comes right away. Otherwise several quick bot clicks merge into a single
      // stroke and their jumps hide inside it.
      closeStroke();
      last = { x: e.x, y: e.y, t: e.t };
      continue;
    }

    if (e.type === 'click') {
      // A real click with detail = 0 is a keyboard activation (Enter/Space):
      // legitimate. A click with no real press in the previous second came from code.
      const keyboard = e.trusted !== false && e.detail === 0;
      if (!keyboard && e.t - lastTrustedDownT > 1000) st.programmaticClicks++;
    }
  }
  closeStroke();
  return st;
}

function classifyClick(down, stroke, last, o) {
  if (!last) return 'unknown-origin';
  if (!stroke) return dist(last, down) <= o.restPx ? 'stationary' : 'teleport';
  if (!stroke.origin && stroke.moves <= 2) return 'unknown-origin';
  const path = pathLength(stroke.points);
  if (stroke.moves <= 2 && path > o.teleportPx) return 'teleport';
  return 'approached';
}

function describeStroke(stroke, o) {
  const pts = stroke.points;
  const steps = [];
  for (let i = 1; i < pts.length; i++) steps.push(dist(pts[i - 1], pts[i]));
  const chord = pts.length > 1 ? dist(pts[0], pts[pts.length - 1]) : 0;
  const eligible = steps.length >= o.minStrokeSteps && chord >= o.minStrokeChordPx;
  if (!eligible) return { eligible: false, points: pts.length };

  const maxDev = Math.max(0, ...pts.map(p => lineDistance(p, pts[0], pts[pts.length - 1])));
  const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
  const sd = Math.sqrt(steps.reduce((a, b) => a + (b - mean) ** 2, 0) / steps.length);

  return { eligible: true, points: pts.length, chord, maxDev, stepCv: mean ? sd / mean : 0 };
}

function buildSignals(st, o) {
  const shape = st.strokes.filter(s => s.eligible);
  const known = st.clicks.filter(c => c.kind !== 'stationary');
  const teleports = known.reduce((n, c) => n + (c.kind === 'teleport' ? 1 : c.kind === 'unknown-origin' ? 0.5 : 0), 0);
  const instant = st.holds.filter(h => h < o.instantReleaseMs).length;
  const straight = shape.filter(s => s.maxDev <= o.straightMaxDevPx).length;
  const uniform = shape.reduce((n, s) => n + ramp(s.stepCv, o.uniformCvHigh, o.uniformCvLow), 0);

  const instantKeys = st.keyHolds.filter(h => h < o.instantKeyMs).length;
  const keyGaps = [];
  for (let i = 1; i < st.keyDowns.length; i++) {
    const gap = st.keyDowns[i] - st.keyDowns[i - 1];
    if (gap < o.keyBurstGapMs) keyGaps.push(gap);
  }
  const gapMedian = median(keyGaps);
  const machine = keyGaps.length >= 5 ? ramp(gapMedian, o.machineKeyHighMs, o.machineKeyLowMs) : 0;

  // Text that arrives without keystrokes is normal for voice dictation, so on
  // its own it proves little. What gives a fill() bot away is that nothing
  // else in the visit looks human: no stroke shaped like a hand, no click
  // reached along a path, no keystroke held like a finger, no tap.
  const humanStrokes = shape.filter(s => s.maxDev > o.straightMaxDevPx && s.stepCv >= o.uniformCvHigh).length;
  const humanEvidence = humanStrokes
    + (st.clicks.filter(c => c.kind === 'approached').length)
    + st.keyHolds.filter(h => h >= o.humanKeyMs).length
    + st.touches;
  const machineFill = st.keyless > 0 && humanEvidence === 0;

  const raw = {
    'trap-hit': [st.trapHits ? 1 : 0, st.trapHits ? 1 : 0, `${st.trapHits} proofs`],
    'untrusted-events': [st.untrusted ? 1 : 0, Math.min(1, 0.5 + st.untrusted / 6), `${st.untrusted} events`],
    'programmatic-click': [st.programmaticClicks ? 1 : 0, Math.min(1, st.programmaticClicks / 2), `${st.programmaticClicks} clicks`],
    'teleport-click': [frac(teleports, known.length), Math.min(1, known.length / 2), `${fmt(teleports)} of ${known.length} clicks`],
    'instant-release': [frac(instant, st.holds.length), Math.min(1, st.holds.length / 2), `${instant} of ${st.holds.length} presses < ${o.instantReleaseMs} ms`],
    'dead-center-click': [frac(st.centerHits, st.centerEligible), Math.min(1, st.centerEligible / 2), `${st.centerHits} of ${st.centerEligible} clicks`],
    'teleport-move': [st.teleportMoves ? 1 : 0, Math.min(1, st.teleportMoves / 3), `${st.teleportMoves} jumps`],
    'straight-strokes': [frac(straight, shape.length), Math.min(1, shape.length / 2), `${straight} of ${shape.length} strokes`],
    'uniform-speed': [frac(uniform, shape.length), Math.min(1, shape.length / 2), `${fmt(uniform)} of ${shape.length} strokes`],
    'instant-keys': [frac(instantKeys, st.keyHolds.length), Math.min(1, st.keyHolds.length / 3), `${instantKeys} of ${st.keyHolds.length} keys < ${o.instantKeyMs} ms`],
    'machine-typing': [machine, Math.min(1, keyGaps.length / 10), keyGaps.length ? `median ${fmt(round(gapMedian))} ms between keys` : 'no typing'],
    'keyless-text': [st.keyless ? 1 : 0, Math.min(1, st.keyless / 2), `${st.keyless} fields`],
    'machine-fill': [machineFill ? 1 : 0, machineFill ? 1 : 0, machineFill ? `${st.keyless} fields, no human input` : `${humanEvidence} human inputs`],
  };

  return Object.entries(raw).map(([id, [suspicion, confidence, detail]]) => {
    const { weight, label } = SIGNALS[id];
    return {
      id, label, weight,
      suspicion: round(suspicion),
      confidence: round(confidence),
      contribution: round(weight * suspicion * confidence),
      detail,
    };
  });
}

function verdictFor(score, st, o) {
  if (score >= o.botThreshold) return 'bot';
  const enough = (st.moves >= o.minMovesForHuman && st.strokes.length >= o.minStrokesForHuman)
    || st.keyHolds.length >= o.minKeysForHuman;
  if (!enough) return 'insufficient-data';
  return score <= o.humanThreshold ? 'human' : 'uncertain';
}

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const round = n => Math.round(n * 1000) / 1000;
const fmt = n => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const frac = (a, b) => (b ? a / b : 0);
const median = list => {
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
// 1 when v <= low, 0 when v >= high, linear in between.
const ramp = (v, high, low) => Math.min(1, Math.max(0, (high - v) / (high - low)));

function pathLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

function signedLineDistance(p, a, b) {
  const len = dist(a, b);
  if (!len) return dist(a, p);
  return ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len;
}

const lineDistance = (p, a, b) => Math.abs(signedLineDistance(p, a, b));

function countBy(list, key) {
  const out = {};
  for (const item of list) out[key(item)] = (out[key(item)] || 0) + 1;
  return out;
}
