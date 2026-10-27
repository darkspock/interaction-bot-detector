# Usage guide

A typical integration has two parts. The browser records how the page is used and sends that record, the **trace**, together with the form. The server analyzes the trace and decides whether to accept the submission. A third part, the **trap**, is optional and protects one important button.

## 0. Load the library

The library is a set of standard ES modules with no dependencies and no build step. It has been tested with Node 26 and current Chromium.

- **Browser:** import it through your bundler (`import { createDetector } from 'interaction-bot-detector'`), or serve the `src/` folder and import `src/index.js` directly from a `<script type="module">`.
- **Server:** import it with `import` from Node. Only `analyze()` is needed there; it does not touch the DOM.

It is not published to npm. Install it from the path where you keep a copy of this repository, for example `npm install ../interaction-bot-detector`.

## 1. Record in the browser

Create one detector per page and start it as soon as the page loads, so it sees the whole visit:

```js
import { createDetector } from 'interaction-bot-detector';

const detector = createDetector().start();
```

The detector listens on `window` and keeps the last 5,000 events. When the user submits, send `detector.export()` along with the form data:

```js
form.addEventListener('submit', async event => {
  event.preventDefault();
  const response = await fetch('/api/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: Object.fromEntries(new FormData(form)), trace: detector.export() }),
  });
  if (response.ok) showConfirmation();
  else showErrorPage(response.status); // a rejected bot sees an ordinary error
});
```

A full trace of 5,000 events is a few hundred kilobytes of JSON. Set a request body limit on the server that allows it; the demo server uses 1 MB.

You can also call `detector.analyze()` in the browser, for example to show a live panel as the demo does. Never base the decision on it: the bot controls the browser.

## 2. Decide on the server

The server runs `analyze()` on the trace it receives. This is a shortened version of the `decide()` function in `demo/decide.js`, which the demo uses. Copy it into your backend and adapt it:

```js
import { analyze } from 'interaction-bot-detector';

const INTERACTION = new Set(['move', 'down', 'touch', 'keydown', 'input']);

const BOT_ERRORS = [
  { status: 404, title: 'Not Found' },
  { status: 500, title: 'Internal Server Error' },
  { status: 503, title: 'Service Unavailable' },
];

export function decide(trace) {
  // The trace comes from the client: drop anything not shaped like an event.
  const events = Array.isArray(trace)
    ? trace.filter(e => e && typeof e === 'object' && Number.isFinite(e.t))
    : [];
  // A real visit always leaves some trace; none at all means a direct call to the API.
  const interacted = events.some(e => INTERACTION.has(e.type));
  const { verdict } = analyze(events);
  // Add your other checks here: rate limits, email verification, payment risk…
  if (interacted && verdict !== 'bot') return { status: 200, body: { ok: true } };
  const error = BOT_ERRORS[Math.floor(Math.random() * BOT_ERRORS.length)];
  return { status: error.status, body: { error } };
}
```

The choices behind this pattern:

- **Reject only `bot`.** `insufficient-data` and `uncertain` go through. Someone who fills a form with the keyboard alone, or taps through it on a phone, gives the analyzer little to work with, and that is not a reason to block them.
- **Reject submissions with no interaction at all.** A person using the page always moves the mouse, clicks, taps or types. A request with an empty or missing trace never went through the page.
- **Do not tell the bot it was detected.** Answer with an ordinary HTTP error and nothing else. Never send the verdict, the score or the signals back to the client. The demo version picks among six codes and delays its 504 by 2.5 s, like a real timeout.
- **Treat the verdict as one input.** For high-value actions, consider an extra step people can pass, such as an emailed code, when the verdict is `insufficient-data`: the analyzer had little to go on.
- **Give people a way out.** A person wrongly flagged as a bot sees errors they cannot explain. Count rejections on the server, per account, email or IP address, and offer an alternative check after a few in a row.

## 3. Add the trap (optional)

The trap watches one button. At the moment someone is about to click it, the trap moves it, and the way they react tells people and bots apart.

Terms used below:

- **Jump:** the cursor appears on the button in one or two large steps with no path leading to it. Automation does this; a hand does not. [How it works](how-it-works.md#mouse) gives the exact thresholds.
- **Click without movement:** a press somewhere the mouse never moved to. It is typical of agents that work from screenshots. Resting the cursor on the button and clicking later is not one.
- **Spring:** each time the trap moves the button.
- **Decoy:** an invisible element the trap places over the button's old spot. It absorbs clicks so they activate nothing.
- **Chase:** clicking the button in its new position less than 150 ms after it moved, sooner than a person can notice the change.
- **Records:** what the trap notes down. A blind click on the old spot is a `decoy-click`; a click there after a normal approach is a `missed-click`; a chase is a `fast-retarget`; a click without movement on the button is a `no-move-click`. Only `decoy-click` and `fast-retarget` prove a bot. [How it works](how-it-works.md#the-trap) explains each one.

Choose one of two modes with the `trigger` option.

### `'jump'` mode (default)

The button only moves when the cursor lands on it with a jump, or when it gets a click without movement. A person who approaches along a path never sees it move, except in the rare cases listed under [Limitations](how-it-works.md#limitations). The button moves instantly, with no animation, to a nearby spot where it covers no other control, and a decoy takes its old place.

```js
import { createDetector, createTrap } from 'interaction-bot-detector';

const detector = createDetector().start();
const trap = createTrap(document.querySelector('#save'), {
  detector,
  onEvidence: record => {
    if (record.kind === 'decoy-click' || record.kind === 'fast-retarget') sendFormNow();
  },
}).start();
```

Bots that move along a path, such as Playwright's `mouse.move` with steps, never set it off; the analyzer's stroke signals (straight lines, constant speed) are what catch them.

The button moves at most three times (`maxSprings`). After that the trap stops moving it but keeps recording. A jump onto the button then goes through. A click without movement is still cancelled, but repeating it on the same spot goes through, because the cursor is now resting there. Whatever goes through reaches your server with the earlier records in the trace, and the server decides.

### `'approach'` mode

The button moves once for everyone, as soon as any cursor reaches it, like a notice that loads late and pushes it down. People see the change, aim again and click.

A person who clicks quickly may hit the old spot before noticing. That click is recorded as a `missed-click`, cancelled, and nothing else happens: no error. Their next click goes through, because the button only moves once. The exception is a click within 150 ms of the move, which a person cannot manage.

Without `displace`, the button moves the same way as in `'jump'` mode: instantly, to a free spot, with a decoy. The more natural option is to reveal a notice above the buttons:

```html
<p class="notice" id="late-notice" hidden>Check that your email is correct: you will use it to sign in.</p>
<div class="buttons">
  <button type="reset">Clear</button>
  <button type="submit" id="accept">Accept</button>
</div>
```

```js
const notice = document.getElementById('late-notice');
const trap = createTrap(document.getElementById('accept'), {
  detector,
  trigger: 'approach',
  displace: () => {
    notice.hidden = false;
    return () => { notice.hidden = true; }; // undoes it when the trap stops
  },
  onEvidence: record => {
    if (record.kind === 'decoy-click' || record.kind === 'fast-retarget') sendFormNow();
  },
}).start();
```

### Sending the proof to the server

In both examples, `sendFormNow()` stands for your own function that submits the form immediately, with the trace. Why send it at all? The bot's click was cancelled, so otherwise nothing would reach the server. Sending it with the proof in the trace lets the server answer with its error: a single `decoy-click` or `fast-retarget` is enough for a `bot` verdict. The bot sees an ordinary failure.

Pass `detector` so the trap's records end up in the trace. Without it, they stay in `trap.evidence` and the server never sees them.

### Rules for the trap

- **Do not animate the move.** If the button glides to its new place with a CSS transition, Playwright waits for it to stop, arrives more than 150 ms later and the chase is not detected.
- **Make the notice at least as tall as the button.** Then the button ends up fully below its old spot and the notice sits where it was, so whoever clicks the old spot hits the notice.
- **Clicks on the old spot are detected by position**, with or without a decoy, for `decoyMs` (10 s by default). If the move leaves another control on the old spot, the trap also covers it with a decoy and cancels clicks there, so nobody clicks "Cancel" while meaning to click "Save".
- **The keyboard is never affected.** Pressing Enter or Space on the button is never cancelled and never moves anything.
- **Touch and pen are ignored.** Taps on phones and tablets go through untouched.
- **In `'approach'` mode everyone pays a small cost.** People who click quickly miss the first time, and a button near the bottom of the screen may be pushed out of view.

## 4. Check it on your pages

Run the demo (`npm run demo`) to see the signals live while you use the forms. On your own pages, collect traces from real users and from your test automation and run `analyze()` over them before you rely on the thresholds: they are heuristic and need checking against your audience. The demo's "Download trace" button saves the current trace as JSON for that purpose.

## API reference

```js
import {
  createDetector, analyze, createTrap, InteractionRecorder, DEFAULTS, TRAP_DEFAULTS,
} from 'interaction-bot-detector';
```

### `createDetector(options?)`

Creates a recorder and returns a small wrapper around it.

| Option | Default | Meaning |
|---|---|---|
| `target` | `window` | Where to listen for events |
| `maxEvents` | `5000` | Maximum events kept; older ones are dropped |
| any `analyze()` option | | Default options for `detector.analyze()` |

Returns an object with:

| Member | Description |
|---|---|
| `start()` | Starts listening. Returns the detector |
| `stop()` | Stops listening. Returns the detector |
| `reset()` | Clears the recorded events. Returns the detector |
| `analyze(options?)` | Runs `analyze()` on the recorded events |
| `export()` | Returns a copy of the recorded events, ready to send as JSON |
| `recorder` | The underlying `InteractionRecorder` |

### `analyze(events, options?)`

Pure function: takes a trace and returns a result. It does not use the DOM and runs in Node or in the browser. The order of the events does not matter. [How it works](how-it-works.md) explains strokes, the signals and the click kinds referred to below.

```js
{
  verdict: 'human' | 'bot' | 'uncertain' | 'insufficient-data',
  score: 0.93,                 // 0 human … 1 bot
  signals: [{
    id: 'teleport-click',      // stable identifier
    label: 'Clicks reached by a cursor jump, with no path',
    weight: 0.9,               // maximum contribution of this signal
    suspicion: 1,              // 0 … 1: how bot-like the evidence looks
    confidence: 0.5,           // 0 … 1: how much evidence there is
    contribution: 0.45,        // weight × suspicion × confidence
    detail: '1 of 1 clicks',
  }, /* one entry per signal, active or not */],
  stats: {
    moves,                     // mouse moves
    strokes,                   // runs of moves without a pause
    shapeStrokes,              // strokes long enough to be analyzed for shape
    clicks,                    // mouse presses
    clickKinds,                // { teleport, approached, stationary, 'unknown-origin' }
    holds,                     // mouse button hold times, ms
    keys,                      // keystrokes with a measured hold time
    keylessInputs,             // fields filled without keystrokes
    touches,                   // touch and pen presses
  },
}
```

Options, all in the exported `DEFAULTS`. Where an option comes as a pair, suspicion rises gradually between the two values.

| Option | Default | Meaning |
|---|---|---|
| `botThreshold` | `0.7` | Score at or above which the verdict is `bot` |
| `humanThreshold` | `0.3` | Score at or below which the verdict can be `human` |
| `minMovesForHuman` | `30` | Mouse moves needed for a `human` verdict… |
| `minStrokesForHuman` | `3` | …together with this many strokes |
| `minKeysForHuman` | `20` | Or this many keystrokes, with or without mouse data |
| `strokeGapMs` | `120` | A pause longer than this splits two strokes; releasing the mouse button also ends a stroke |
| `restPx` | `3` | A click this close to the last position counts as "without moving" |
| `teleportPx` | `40` | Distance that makes an arrival a jump (see How it works) |
| `instantReleaseMs` | `10` | Mouse button released sooner than this is instant |
| `centerTolerancePx` | `0.75` | A click this close to an element's centre is "dead centre" |
| `centerMinW`, `centerMinH` | `20`, `14` | Smallest element considered for dead-centre clicks |
| `minStrokeChordPx`, `minStrokeSteps` | `80`, `5` | Shorter strokes are not analyzed for shape |
| `straightMaxDevPx` | `0.5` | Maximum deviation from a straight line for a "perfect line" |
| `uniformCvLow`, `uniformCvHigh` | `0.12`, `0.25` | Variation of step length: at the low value or below, constant speed; at the high value or above, normal |
| `instantKeyMs` | `10` | Key released sooner than this is instant |
| `keyBurstGapMs` | `1000` | Pauses longer than this split typing bursts |
| `machineKeyLowMs`, `machineKeyHighMs` | `15`, `40` | Median gap between keys: at the low value or below, machine; at the high value or above, normal |
| `keylessWindowMs` | `100` | Text arriving all at once, or set by a script, counts as keyless if no keystroke, mouse press or tap came within this window before it |
| `humanKeyMs` | `30` | A key held at least this long counts as human input for `machine-fill` |

### `InteractionRecorder`

The recorder used by `createDetector()`. Use it directly only if you need to control storage yourself.

```js
const recorder = new InteractionRecorder({ target: window, maxEvents: 5000 }).start();
recorder.events;   // the recorded events
recorder.add(e);   // appends an event (the trap uses this)
recorder.clear();
recorder.stop();
```

### `createTrap(button, options?)`

| Option | Default | Meaning |
|---|---|---|
| `trigger` | `'jump'` | `'jump'` or `'approach'`, see above |
| `detector` | | A detector whose trace receives the trap records |
| `onEvidence(record)` | | Called for every record |
| `onSpring({ t, springs })` | | Called every time the button moves |
| `displace(button)` | | Moves the button your own way; may return an undo function. A decoy is then added only if another control ends up on the old spot. Without it, the button moves with `translate` and a decoy always covers its old spot |
| `offset` | | Fixed `{ x, y }` shift for the default move; without it, a free spot is chosen |
| `cancel` | `true` | Cancel the clicks that get recorded |
| `reactionMs` | `150` | Clicking the moved button sooner than this is `fast-retarget` |
| `decoyMs` | `10000` | How long clicks on the old spot count and how long the decoy stays |
| `maxSprings` | `3` | Times the button may move. Only applies to `'jump'` mode without `displace`; `'approach'` mode, and any mode with `displace`, move it once |
| `teleportPx`, `strokeGapMs`, `restPx` | `40`, `120`, `3` | Same meaning as in `analyze()` |

Returns an object with:

| Member | Description |
|---|---|
| `evidence` | The records so far |
| `springs` | How many times the button has moved |
| `start()` | Starts watching. Returns the trap |
| `stop()` | Stops watching, removes the decoy and puts the button back |
| `reset()` | Stops, clears the records and the move count, and starts again |

Records have the form `{ type: 'trap', kind, t, x, y }`, where `kind` is one of `decoy-click`, `missed-click`, `fast-retarget` or `no-move-click`.

### Trace format

A trace is an array of plain objects. Times are `event.timeStamp` values in milliseconds; coordinates are viewport pixels.

| `type` | Fields | Recorded from |
|---|---|---|
| `move` | `t, x, y, trusted` | `pointermove` (mouse only) |
| `down` | `t, x, y, trusted, button, targets` | `pointerdown` (mouse); `targets` holds `{ dx, dy, w, h }`: the offset from the centre of the pressed element and of up to three ancestors, measured against each element's current box and against its box when the cursor entered it |
| `up` | `t, x, y, trusted, button` | `pointerup` (mouse) |
| `click` | `t, x, y, trusted, detail` | `click` |
| `touch` | `t, trusted` | `pointerdown` from touch or pen; no position |
| `leave` | `t` | the cursor leaving the window, the window losing focus, or the cursor coming back from a native dropdown |
| `keydown` | `t, trusted` | `keydown`, without the key |
| `keyup` | `t, trusted, hold` | `keyup`; `hold` is how long the key was down, in ms |
| `input` | `t, trusted, inputType, bulk` | `input`; `bulk` is true when more than one character arrived at once. `trusted: false` means a script set the value and fired its own `input` event, as automation form tools do |
| `trap` | `t, kind, x, y` | the trap |

Events created by a script (`isTrusted = false`) are recorded with `trusted: false`.
