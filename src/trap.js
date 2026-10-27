// Optional trap for one specific button (for example, "Save").
//
// It moves the button right when someone is about to click it and watches how
// they react. A person sees it moved and aims again with the mouse; a bot
// clicks where it was, or chases it faster than anyone can react.
//
// Two modes (`trigger` option):
//
//   'jump' (default)  It only moves if the cursor lands on it with a jump or
//                     someone clicks without having moved the mouse. People
//                     never see it. It can move several times.
//   'approach'        It moves once for everyone, as soon as the cursor reaches
//                     the button, like when a page loads a notice late. The
//                     second attempt works.
//
// How it moves: by default with the `translate` property towards a free spot,
// leaving an invisible decoy where it was. With `displace(button)` it can be
// done your own way, for example by showing a notice above it that pushes it
// down; if it returns a function, that function undoes it when the trap stops.
//
// What gets recorded (`evidence`, and `onEvidence` for each item):
//
//   decoy-click     clicked where the button was without looking: in 'jump'
//                   mode, always; in 'approach', if the cursor reached the
//                   button with a jump, or if the button moved because of a
//                   click without movement and the cursor has not moved since
//                   (an agent reusing its old screenshot).
//   missed-click    ('approach') clicked where the button was after approaching
//                   with a path. People who click in a hurry do it too: it
//                   proves nothing.
//   fast-retarget   clicked the button in its new position sooner than a person
//                   can notice it moved (this is how Playwright retries).
//   no-move-click   clicked the button without having moved the mouse to it
//                   (agents working from screenshots). The click is cancelled
//                   and the button moves.
//
// Only decoy-click and fast-retarget prove a bot. With { cancel: true } (the
// default) recorded clicks never reach the page.

import { opensNativeUi } from './native-ui.js';

export const TRAP_DEFAULTS = {
  trigger: 'jump',
  teleportPx: 40,      // a first stroke step longer than this = arrival by jump
  strokeGapMs: 120,    // after this long without moving, the next move starts a new stroke
  restPx: 3,           // clicking closer than this to the last move = cursor at rest
  reactionMs: 150,     // clicking the moved button sooner than this is not human
  decoyMs: 10000,      // how long clicking the old spot counts (screenshot agents take seconds)
  maxSprings: 3,       // times the button can move in 'jump' mode
  cancel: true,
};

const INTERACTIVE = 'a[href], button, input, select, textarea, label, summary, [role=button], [tabindex]:not([tabindex="-1"])';

const overlapArea = (a, b) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

export function createTrap(button, { detector, onEvidence, onSpring, offset, displace, ...options } = {}) {
  const o = { ...TRAP_DEFAULTS, ...options };
  const approach = o.trigger === 'approach';
  const maxSprings = approach || displace ? 1 : o.maxSprings;
  const doc = button.ownerDocument;
  const win = doc.defaultView;
  const evidence = [];
  const listeners = [];
  const originalTranslate = button.style.translate;

  let last = null;
  let lastT = -Infinity;
  let springs = 0;
  let sprungAt = -Infinity;
  let oldRect = null;       // where the button was, in document coordinates
  let springCause = null;   // 'jump' (arrived by jump), 'approach' (with a path) or 'no-move'
  let movedSinceSpring = false;
  let retargetReported = 0; // move number for which fast-retarget was already recorded
  let shifted = false;
  let undo = null;
  let decoy = null;
  let decoyTimer = null;
  let swallowUntil = -Infinity;
  let nativeUi = false; // a native dropdown or date picker was opened

  const report = (kind, e) => {
    const item = { type: 'trap', kind, t: e.timeStamp, x: e.clientX, y: e.clientY };
    evidence.push(item);
    detector?.recorder.add(item);
    onEvidence?.(item);
  };

  const swallowClick = e => {
    if (o.cancel) swallowUntil = e.timeStamp + 1000;
  };

  const placeDecoy = r => {
    if (!decoy) {
      decoy = doc.createElement('div');
      decoy.setAttribute('aria-hidden', 'true');
      decoy.dataset.botTrap = 'decoy';
      Object.assign(decoy.style, { position: 'fixed', zIndex: '2147483647', background: 'transparent' });
      doc.body.append(decoy);
    }
    Object.assign(decoy.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    clearTimeout(decoyTimer);
    decoyTimer = setTimeout(removeDecoy, o.decoyMs);
  };

  const removeDecoy = () => {
    clearTimeout(decoyTimer);
    decoy?.remove();
    decoy = null;
  };

  // Moves the button at that very moment, before the press arrives.
  const spring = (e, cause) => {
    if (springs >= maxSprings) return;
    springCause = cause;
    movedSinceSpring = false;
    const r = button.getBoundingClientRect();
    oldRect = { left: r.left + win.scrollX, right: r.right + win.scrollX, top: r.top + win.scrollY, bottom: r.bottom + win.scrollY };
    if (displace) {
      undo = displace(button) ?? null;
      // If whatever ended up where the button was can be clicked (another
      // button that moved too), a decoy covers it: nobody should click
      // "Cancel" while meaning to click "Save".
      if (interactiveRects().some(q => overlapArea(r, q) > 0)) placeDecoy(r);
    } else {
      // `translate` neither changes the layout nor overrides the page's
      // `transform`. In 'jump' mode it alternates between moved and back.
      placeDecoy(r);
      shifted = !shifted;
      if (shifted) {
        const { x, y } = offset ?? freeShift(r);
        button.style.translate = `${x}px ${y}px`;
      } else {
        button.style.translate = originalTranslate;
      }
    }
    springs++;
    sprungAt = e.timeStamp;
    onSpring?.({ t: e.timeStamp, springs });
  };

  // Where to move the button without covering another control: if a person
  // triggers the trap by accident and goes to click "Cancel", they must not end
  // up clicking "Save". Preference: a visible free spot, then a free spot off
  // screen and, only as a last resort, the one that covers the least.
  const freeShift = r => {
    const dx = r.width + 40, dy = r.height + 40;
    const candidates = [[0, dy], [0, -dy], [dx, 0], [-dx, 0], [0, 2 * dy], [0, -2 * dy], [2 * dx, 0], [-2 * dx, 0]];
    const others = interactiveRects();
    let best = null;
    for (const [x, y] of candidates) {
      const q = { left: r.left + x, right: r.right + x, top: r.top + y, bottom: r.bottom + y };
      const covered = others.reduce((sum, o) => sum + overlapArea(q, o), 0);
      const visible = q.left >= 0 && q.top >= 0 && q.right <= win.innerWidth && q.bottom <= win.innerHeight;
      const rank = covered > 0 ? 2 + covered : visible ? 0 : 1;
      if (!best || rank < best.rank) best = { x, y, rank };
      if (rank === 0) break;
    }
    return best;
  };

  // Boxes of the other clickable controls on the page.
  const interactiveRects = () => [...doc.querySelectorAll(INTERACTIVE)]
    .filter(el => el !== button && !button.contains(el) && !el.contains(button))
    .map(el => el.getBoundingClientRect())
    .filter(q => q.width && q.height);

  const inside = (x, y) => {
    const r = button.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  };

  // Is this a click on the spot where the button was before it moved?
  const onOldSpot = e => {
    if (!oldRect || e.timeStamp - sprungAt > o.decoyMs || button.contains(e.target)) return false;
    const x = e.clientX + win.scrollX, y = e.clientY + win.scrollY;
    return x >= oldRect.left && x <= oldRect.right && y >= oldRect.top && y <= oldRect.bottom;
  };

  const tooFast = e => {
    if (e.timeStamp - sprungAt >= o.reactionMs) return false;
    if (retargetReported !== springs) {
      retargetReported = springs;
      report('fast-retarget', e);
    }
    return true;
  };

  const handlers = {
    pointermove(e) {
      if (e.pointerType !== 'mouse') return;
      const p = { x: e.clientX, y: e.clientY };
      // When a native dropdown closes, the cursor reappears where the person
      // picked the option, maybe on top of the button: that is not a bot jump.
      // Chrome first sends a move with no displacement; that one does not count.
      const moved = !last || Math.hypot(p.x - last.x, p.y - last.y) > o.restPx;
      if (springs && moved) movedSinceSpring = true;
      const fresh = e.timeStamp - lastT > o.strokeGapMs;
      const jump = last ? Math.hypot(p.x - last.x, p.y - last.y) : Infinity;
      const landedByJump = fresh && jump > o.teleportPx;
      if (nativeUi) {
        if (moved) nativeUi = false;
      } else if (inside(p.x, p.y) && e.buttons === 0) {
        if (approach) {
          // For everyone, as soon as the cursor arrives. Speed while passing is
          // not checked here: someone moving down fast can cross the new
          // position without having reacted to anything. Only the press counts.
          spring(e, landedByJump ? 'jump' : 'approach');
        } else if (!tooFast(e) && landedByJump) {
          spring(e, 'jump');
        }
      }
      last = p;
      lastT = e.timeStamp;
    },
    pointerdown(e) {
      if (e.pointerType !== 'mouse') return;
      if (opensNativeUi(e.target)) nativeUi = true;
      if (onOldSpot(e) || (decoy && e.target === decoy)) {
        const blind = springCause === 'jump' || (springCause === 'no-move' && !movedSinceSpring);
        report(!approach || blind ? 'decoy-click' : 'missed-click', e);
        e.preventDefault();
        swallowClick(e);
        return;
      }
      if (!button.contains(e.target)) return;
      if (tooFast(e)) { swallowClick(e); return; }
      if (springs >= maxSprings && approach) return; // already moved: the second attempt goes through
      const still = last && Math.hypot(e.clientX - last.x, e.clientY - last.y) <= o.restPx;
      if (!still || (approach && springs === 0)) {
        if (!still) report('no-move-click', e);
        if (o.cancel) { swallowClick(e); spring(e, still ? 'approach' : 'no-move'); }
      }
    },
    // Releasing closes the stroke, as in the analyzer: the next move counts as
    // a new arrival even if the bot chains clicks without a pause.
    pointerup(e) {
      if (e.pointerType !== 'mouse') return;
      last = { x: e.clientX, y: e.clientY };
      lastT = -Infinity;
    },
    click(e) {
      // detail = 0: keyboard activation, never cancelled.
      if (e.detail === 0 || e.timeStamp > swallowUntil) return;
      swallowUntil = -Infinity;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    pointerout(e) {
      if (e.pointerType === 'mouse' && !e.relatedTarget) last = null;
    },
  };

  return {
    evidence,
    get springs() { return springs; },
    start() {
      if (listeners.length) return this;
      for (const [type, fn] of Object.entries(handlers)) {
        win.addEventListener(type, fn, true);
        listeners.push([type, fn]);
      }
      return this;
    },
    stop() {
      for (const [type, fn] of listeners) win.removeEventListener(type, fn, true);
      listeners.length = 0;
      removeDecoy();
      undo?.();
      undo = null;
      button.style.translate = originalTranslate;
      shifted = false;
      return this;
    },
    reset() {
      this.stop();
      evidence.length = 0;
      springs = 0;
      retargetReported = 0;
      sprungAt = -Infinity;
      oldRect = null;
      springCause = null;
      return this.start();
    },
  };
}
