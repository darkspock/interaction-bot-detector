# How it works

Automation tools act like programs. They place the cursor directly on the target instead of moving it there, they press and release a button in the same millisecond, they type faster than any hand and they fill fields without pressing keys. The library records how the page is used and measures those traits. Each trait is a **signal**; the signals combine into a **score** and a **verdict**.

The trap adds a test of behaviour on top. It changes the page at the moment of the click and watches the reaction. A person sees the change and adapts; a program working from a fixed plan does not.

## What is recorded

The recorder listens on the window during the whole visit.

- **Mouse:** every pointer move, press and release, with time and position. For each press, it also records the offset from the centre of the pressed element.
- **Touch and pen:** only the moment of each press, with no position or path. A tap counts as real interaction but provides no evidence either way.
- **Keyboard:** when each key goes down and how long it is held. Which key it was is never stored: the recorder keeps the key in memory only long enough to pair the press with its release.
- **Text input:** the kind of input (typing, pasting, autocomplete) and whether more than one character arrived at once. It also records when a script sets a field's value and fires its own `input` event, which is how automation form tools fill fields. The text itself is never stored.
- **Events created by scripts:** events that a script fabricates with `dispatchEvent` arrive with `isTrusted = false` and are recorded as untrusted.

Even without the keys, the number of keystrokes reveals roughly how long a typed value was, a password included. Mouse paths and typing rhythm are behavioural data and can help identify a person, so treat traces as personal data and check with your data protection team before storing them.

## The signals

Each signal produces two numbers between 0 and 1. The **suspicion** says how bot-like the evidence looks. The **confidence** says how much evidence there is: a single click is weaker evidence than five. The signal's **contribution** is `weight × suspicion × confidence`.

### Mouse

Three terms first:

- A **stroke** is a run of mouse moves without a pause longer than 120 ms. Releasing the mouse button also ends a stroke, so that several quick bot clicks do not merge into one long stroke that hides their jumps.
- A **jump** is an arrival with no path. For clicks, it means the press came after at most two moves adding up to more than 40 px. For cursor moves and for the trap, it means the first move of a new stroke covered more than 40 px in one step.
- A **click without movement** is a press somewhere the mouse never moved to: more than 3 px from its last known position, with no move in between.

| Signal | What it measures | Weight | Why people rarely do it |
|---|---|---|---|
| `teleport-click` | Clicks reached by a jump, or clicks without movement | 0.9 | A hand moves the cursor gradually, so a press is preceded by a stream of small moves |
| `instant-release` | Mouse button released less than 10 ms after being pressed | 0.6 | A physical click takes tens of milliseconds |
| `dead-center-click` | Click within 0.75 px of the exact centre of the element or one of its three closest ancestors | 0.55 | Automation computes the centre of the element; a hand lands anywhere on it |
| `straight-strokes` | Strokes of 80 px or more that deviate less than 0.5 px from a straight line | 0.7 | Hand movements curve; even a quick straight flick deviates by around a pixel |
| `uniform-speed` | Strokes whose steps all have nearly the same length, meaning constant speed. A variation of step length of 0.12 or less scores 1, 0.25 or more scores 0, and values in between score in proportion | 0.6 | A hand accelerates and decelerates, so step lengths vary widely |
| `teleport-move` | Jumps with no click, such as `hover()` | 0.5 | The cursor only reappears elsewhere when it leaves the window or crosses an iframe |

### Keyboard

| Signal | What it measures | Weight | Why people rarely do it |
|---|---|---|---|
| `instant-keys` | Keys released less than 10 ms after being pressed | 0.7 | A key press takes tens of milliseconds |
| `machine-typing` | Median gap between keystrokes within typing bursts. 15 ms or less scores 1, 40 ms or more scores 0, and values in between score in proportion | 0.6 | People type with gaps of tens to hundreds of milliseconds |
| `keyless-text` | Fields filled without typing: several characters arriving at once, or a value set by a script, with no keystroke, mouse press or tap in the previous 100 ms | 0.5 | Typing produces one character per key. Pasting and autocomplete have their own input types and do not count. A page that fills fields in reaction to a click, such as "copy my billing address", does not count either |
| `machine-fill` | Fields filled without typing, and nothing else in the whole visit that looks human: no stroke with a hand's curve and changing speed, no click reached along a path, no keystroke held 30 ms or more, no tap | 0.9 | Even a person who dictates every field by voice usually reaches the fields with the mouse, by touch or with a key |

`keyless-text` weighs less than the others because voice dictation and some phone keyboards also insert text without keystrokes. On its own it is never enough for a `bot` verdict. `machine-fill` is what separates the two cases: someone who dictates also does something human somewhere in the visit; a bot filling fields with `fill()` or a form tool does not.

### Scripts and the trap

| Signal | What it measures | Weight |
|---|---|---|
| `untrusted-events` | Events created by a script (`isTrusted = false`) | 0.95 |
| `programmatic-click` | Clicks with no real mouse press or tap in the previous second. Keyboard activation (a click with `detail = 0`) does not count | 0.6 |
| `trap-hit` | The trap recorded a `decoy-click` or a `fast-retarget` (see below). A single one gives a score of 0.95, enough for a `bot` verdict | 0.95 |

## From signals to a verdict

The score combines the contributions as independent probabilities:

```
score = 1 − (1 − c₁) × (1 − c₂) × … × (1 − cₙ)
```

Two moderate signals therefore add up to a strong one: contributions of 0.6 and 0.5 give a score of 0.8.

The verdict follows from the score and the amount of data:

| Verdict | When |
|---|---|
| `bot` | Score of 0.7 or more |
| `human` | Score of 0.3 or less, with at least 30 mouse moves in 3 strokes, or at least 20 keystrokes |
| `uncertain` | Score between 0.3 and 0.7, with enough data |
| `insufficient-data` | Score below 0.7 without enough data |

A strong bot signal gives a `bot` verdict even with very little data. A `human` verdict always needs a reasonable amount of activity.

### How clicks are classified

Every mouse press is labelled by how the cursor reached it:

- **approached:** a stream of moves led to it. Normal for a person.
- **stationary:** the cursor had not moved since its last known position, as when clicking twice in the same place.
- **teleport:** the press came after a jump, or it was a click without movement.
- **unknown-origin:** the first event on the page was the press itself, or it followed the cursor leaving the window.

The suspicion of `teleport-click` is (teleport presses + half the unknown-origin presses) ÷ (all presses except stationary ones).

### Cases handled so people are not flagged

- **The cursor leaves the window** or the window loses focus: when the cursor comes back somewhere else, that is not a jump.
- **Native dropdowns and date pickers:** while their popup is open the page receives no mouse moves, and when it closes the cursor reappears where the option was picked. The first move after closing does not count as a jump.
- **Buttons that move when pressed:** many styles shift a button by a pixel on `:active`. The element's box is also captured when the cursor enters it, and a dead-centre match against either box counts.
- **Keyboard activation:** Enter or Space on a button produces a click with no mouse press; it is never treated as a programmatic click.
- **Taps:** a touch press makes the click that follows it a real one.

## The trap

The trap protects one button. At the moment someone is about to click it, it moves the button and records what happens next. If the click comes without movement, the trap cancels that click and then moves the button. Touch, pen and keyboard are ignored.

### When the button moves

In **`'jump'` mode** (the default) the button only moves when the cursor lands on it with a jump, or when it gets a click without movement. That is how automation reaches buttons. People approach along a path, so they do not see it move, apart from the rare cases under [Limitations](#limitations). The button moves instantly, with the CSS `translate` property and no animation, to a nearby spot where it covers no other control, on screen if there is room. An invisible **decoy** element covers its old spot and absorbs clicks.

It can move up to three times. After that it stays put and the trap keeps recording. A jump onto the button then goes through. A click without movement is still cancelled, but repeating it on the same spot goes through, because the cursor is now resting there. What goes through reaches the server with the earlier records in the trace.

In **`'approach'` mode** the button moves once for everyone, as soon as any cursor reaches it. By default it moves as in `'jump'` mode. With the `displace()` option you choose how: the demo reveals a notice above the buttons that pushes them down, like content that loads late. Because it moves only once, a person's next attempt goes through.

### What it records

| Record | Meaning | Proves a bot? |
|---|---|---|
| `decoy-click` | A click on the old spot made blindly. The conditions are listed below | Yes |
| `missed-click` | (`'approach'` only) A click on the old spot after approaching along a path. A person in a hurry does this: the click was already on its way when the button moved. It is cancelled and nothing else happens | No |
| `fast-retarget` | A click on the button in its new position less than 150 ms after it moved, which is sooner than a person can notice the change. Playwright's `page.click()` retries this way | Yes |
| `no-move-click` | A click without movement on the button, typical of agents that work from screenshots. The click is cancelled and the button moves | No; `teleport-click` already covers it |

A click on the old spot is blind, and becomes a `decoy-click`, in three cases:

- in `'jump'` mode, always, because the button only moved for a jump or a click without movement;
- in `'approach'` mode, when the cursor reached the button with a jump;
- in `'approach'` mode, when the agent's first click on the button came without movement, which moved the button, and the agent then clicks the old spot again without moving the mouse. This is an agent reusing its old screenshot.

Clicks on the old spot are detected by their position for 10 s (`decoyMs`), whether or not a decoy is there. All recorded clicks are cancelled by default, so they never reach the page.

Two details keep people safe in `'approach'` mode:

- **The chase is measured on the click, not on movement.** Someone moving the mouse quickly down the page can cross the button's new position about 50 ms after it moved without having reacted to anything. Only a click counts.
- **Nothing clickable is left on the old spot.** If the move leaves another control there, a decoy covers it for `decoyMs` and clicks there are cancelled. Nobody ends up clicking "Cancel" while meaning to click "Save".

### Why it works on each kind of automation

| Automation | What it does after the button moves | What gives it away |
|---|---|---|
| Playwright or Puppeteer `click()` | Moves to the element in one step and presses at once, landing on the old spot; then notices the miss and retries within milliseconds | `decoy-click`, `fast-retarget` |
| Agent clicking coordinates | Jumps to the coordinates and presses the old spot | `decoy-click` |
| Agent working from screenshots, reusing the old one | Presses the old spot again without moving the mouse | `decoy-click` |
| Agent that takes a new screenshot | Finds the button and presses it, but arrives with a jump and releases in milliseconds | `teleport-click`, `instant-release` on the server |
| Bot moving in a straight line (`'approach'` mode) | Misses like a person, then aims again in a straight line at constant speed | `straight-strokes`, `uniform-speed` on the server |
| Humanized bot (curves, pauses, human-length presses) | Misses like a person and aims again like a person | Nothing |

## The server decision

The demo server rejects a submission when the trace contains no interaction at all (no mouse move or press, tap, keystroke or text input) or when the verdict is `bot`. It then answers with a random real HTTP error, 404, 429, 500, 502, 503 or 504, and the page shows it as a full error page. The 504 arrives after 2.5 s, like a real timeout. The response never contains the verdict, the score or the signals. The [usage guide](usage.md#2-decide-on-the-server) has a shortened version of the code.

## Measured results

Real Chromium driven by Playwright against the demo's "Edit profile" page (`npm run e2e`):

| Strategy | Verdict | Score |
|---|---|---|
| `page.click()` on every button | bot | 0.998 |
| `mouse.move(…, { steps: 25 })` and click | bot | 0.97 |
| Agent clicking coordinates | bot | 0.99 |
| Script injecting events with `dispatchEvent` | bot | 0.98 |
| Keyboard only, with `keyboard.type()` | bot | 0.88 |
| `fill()` on three fields and a single Enter | bot | 0.96 |
| Bézier curve with easing (ghost-cursor style), with or without jitter | human | 0 |

Two real traces are part of the unit tests:

- **Claude clicking the demo from the Claude app's built-in browser:** no mouse movement at all, presses of 0.4 to 9 ms. Verdict `bot`, score 0.93.
- **A person moving their mouse around the demo:** 411 moves in 20 strokes. Verdict `human`, score 0.

Claude was also measured filling the "Edit profile" form with the built-in browser's form tool, then pressing Tab and Enter: the tool sets values from code and the keys last under 10 ms. Verdict `bot`, score 0.985.

The browser tests (`npm run test:e2e`) cover the trap and the server decision end to end. These get an error page: Playwright bots, coordinate agents, keyboard-only bots, and bots that fill fields with `fill()` or set them from code, whether they submit with one Enter or from code. These get their submission accepted: simulated people using mouse and keyboard, people using only the keyboard, a phone user who only taps, people who dictate a field by voice on a computer or a phone, and people who miss the first click and aim again.

## Limitations

- **Not calibrated against real people.** Apart from one real mouse trace, the "people" in the tests are simulations. Before relying on the thresholds, collect traces from real users, with mouse, trackpad and keyboard, and measure the false positives.
- **Humanized bots pass.** A bot that moves along curves with natural speed, presses for 60–150 ms, aims at a random point and types with random human-like delays is not detected. Neither is one that replays recorded human traces.
- **One human-looking action is enough to pass `machine-fill`.** A bot that fills fields from code but also holds one key for 30 ms or more, reaches one click along a path of moves, or emulates a touch screen and taps once, is not flagged by it. The other signals still judge that path and that keystroke. A bot that only taps leaves no mouse or keyboard evidence at all. The demo server accepts these.
- **A person who uses the page only by voice cannot be told apart from a `fill()` bot.** Someone who dictates every field and also clicks and submits with voice commands, with no mouse, keyboard or touch at all, may be flagged by `machine-fill`. How voice-control software reports its clicks and keys to the page has not been checked.
- **The client can be forged.** A bot that knows the trace format can send a fabricated human-looking trace. The server only judges the trace it receives.
- **Possible false positives, not yet verified:**
  - trackpad tap-to-click, which may produce very short presses;
  - crossing a cross-origin iframe, which looks like a jump;
  - remote desktop and accessibility tools, such as voice or eye-gaze control, which can move the cursor in jumps;
  - very fast typists, text expanders and password managers that type or fill for the user;
  - a person whose cursor enters the window right over the trapped button and clicks at once, which counts as arriving by jump.
- **The native-dropdown handling has only been tested by simulation.** Headless Chromium does not draw native popups, so the tests simulate the cursor jump that follows closing one.
- **Playwright's retry is detected through how Playwright handles its own events today.** A future version could change that.
