// Browser recorder: listens to the mouse and the keyboard on the window and
// stores the events in the format analyzer.js expects.
//
// The trajectory comes from pointer events (fractional coordinates, and they
// let us ignore touch and pen). Mouse events are only listened to in order to
// catch the ones a script creates with dispatchEvent: those produce no pointer
// events and arrive with isTrusted = false.
//
// From the keyboard only timings are stored: when a key goes down, how long it
// is held and whether text arrived all at once. Never which key or which text:
// storing that would make this a keylogger, passwords included.

import { opensNativeUi } from './native-ui.js';

const ANCESTORS = 3;

export class InteractionRecorder {
  constructor({ target = globalThis.window, maxEvents = 5000 } = {}) {
    this.target = target;
    this.maxEvents = maxEvents;
    this.events = [];
    this._listeners = [];
    this._rects = new WeakMap();
    this._nativeUi = false;
    this._lastPos = null;
    this._keysDown = new Map(); // key → moment it went down; kept in memory only, never stored
  }

  start() {
    if (this._listeners.length) return this;
    const on = (type, fn) => {
      this.target.addEventListener(type, fn, { capture: true, passive: true });
      this._listeners.push([type, fn]);
    };

    // Element geometry when the cursor enters, before :active (and sometimes
    // :hover) shifts it with a transform.
    on('pointerover', e => {
      if (e.pointerType !== 'mouse') return;
      for (const el of chain(e.target)) this._rects.set(el, el.getBoundingClientRect());
    });
    on('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      // Back from a native popup: whatever happened in between was not seen.
      // Chrome first sends a move with no displacement; that one does not count.
      const p = this._lastPos;
      if (this._nativeUi && (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 3)) {
        this._nativeUi = false;
        this.add({ type: 'leave', t: e.timeStamp });
      }
      this._lastPos = { x: e.clientX, y: e.clientY };
      this.add({ type: 'move', t: e.timeStamp, x: e.clientX, y: e.clientY, trusted: e.isTrusted });
    });
    on('pointerdown', e => {
      // Touch and pen: only the moment, so a tap counts as real interaction and
      // its click is not mistaken for a programmatic one. No position or path.
      if (e.pointerType !== 'mouse') { this.add({ type: 'touch', t: e.timeStamp, trusted: e.isTrusted }); return; }
      this.add({
        type: 'down', t: e.timeStamp, x: e.clientX, y: e.clientY, trusted: e.isTrusted,
        button: e.button, targets: targetOffsets(e, this._rects),
      });
      this._lastPos = { x: e.clientX, y: e.clientY };
      if (opensNativeUi(e.target)) this._nativeUi = true;
    });
    on('pointerup', e => {
      if (e.pointerType !== 'mouse') return;
      this.add({ type: 'up', t: e.timeStamp, x: e.clientX, y: e.clientY, trusted: e.isTrusted, button: e.button });
    });
    for (const [type, kind] of [['mousemove', 'move'], ['mousedown', 'down'], ['mouseup', 'up']]) {
      on(type, e => {
        if (e.isTrusted) return; // real ones already arrive as pointer events
        this.add({ type: kind, t: e.timeStamp, x: e.clientX, y: e.clientY, trusted: false, button: e.button });
      });
    }
    on('click', e => {
      if (e.sourceCapabilities?.firesTouchEvents) return;
      this.add({ type: 'click', t: e.timeStamp, x: e.clientX, y: e.clientY, trusted: e.isTrusted, detail: e.detail });
    });
    on('keydown', e => {
      if (e.repeat) return; // key held down: not a new keystroke
      this._keysDown.set(e.code, e.timeStamp);
      this.add({ type: 'keydown', t: e.timeStamp, trusted: e.isTrusted });
    });
    on('keyup', e => {
      const downT = this._keysDown.get(e.code);
      this._keysDown.delete(e.code);
      this.add({ type: 'keyup', t: e.timeStamp, trusted: e.isTrusted, hold: downT === undefined ? null : e.timeStamp - downT });
    });
    // Only the kind of input (typing, pasting, autocomplete…) and whether more
    // than one character arrived at once. A script that sets a value and fires
    // its own `input` event (as automation tools do) is recorded too: its text
    // arrived all at once, without keystrokes.
    on('input', e => {
      if (e.isTrusted && !e.inputType) return; // trusted but undescribed: tells nothing
      const bulk = e.isTrusted ? (e.data?.length ?? 0) > 1 : true;
      this.add({ type: 'input', t: e.timeStamp, trusted: e.isTrusted, inputType: e.inputType ?? null, bulk });
    });
    // The cursor leaves the window: when it comes back it will be somewhere
    // else, and that is not a jump.
    on('pointerout', e => {
      if (e.pointerType === 'mouse' && !e.relatedTarget) this.add({ type: 'leave', t: e.timeStamp });
    });
    on('blur', e => {
      if (e.target === this.target) this.add({ type: 'leave', t: e.timeStamp });
    });
    return this;
  }

  stop() {
    for (const [type, fn] of this._listeners) this.target.removeEventListener(type, fn, { capture: true });
    this._listeners = [];
    return this;
  }

  clear() {
    this.events = [];
    this._keysDown.clear();
    return this;
  }

  add(event) {
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
  }
}

// Offset of the click from the centre of the pressed element and of its
// closest ancestors: bots aim at the centre of the element they locate, which
// may be the button rather than the <span> inside it. It is measured against
// the current box and against the one stored when the cursor entered; either
// matching is enough.
function targetOffsets(e, cached) {
  const out = [];
  for (const el of chain(e.target)) {
    for (const r of [el.getBoundingClientRect(), cached.get(el)]) {
      if (r) out.push({ dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - (r.top + r.height / 2), w: r.width, h: r.height });
    }
  }
  return out;
}

function chain(el) {
  const out = [];
  for (let i = 0; el && el.getBoundingClientRect && i <= ANCESTORS; i++, el = el.parentElement) out.push(el);
  return out;
}
