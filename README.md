# interaction-bot-detector

A dependency-free JavaScript library that watches how the mouse and keyboard are used on a web page and estimates whether a person or an automation is behind them: Playwright, Puppeteer, Selenium, injected scripts, or AI agents that use a browser.

It catches automation that behaves like a program: a cursor that jumps onto buttons, clicks released within a few milliseconds, perfectly straight movements, keys typed at machine speed. It does not catch a bot built to imitate a person. Use its verdict as one input to a decision made on your server, not as a gate on its own.

## Quick start

Record in the browser and send the trace with the form:

```js
import { createDetector } from 'interaction-bot-detector';

const detector = createDetector().start();

form.addEventListener('submit', async event => {
  event.preventDefault();
  await fetch('/api/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: Object.fromEntries(new FormData(form)), trace: detector.export() }),
  });
});
```

Analyze it on the server:

```js
import { analyze } from 'interaction-bot-detector';

const { verdict, score, signals } = analyze(body.trace);
// verdict: 'human' | 'bot' | 'uncertain' | 'insufficient-data'
// score:   0 (human) … 1 (bot)
```

Analyze on the server, not in the browser: a bot can read and change anything that runs on the page. Also reject submissions whose trace shows no interaction at all, and never send the verdict back to the client; the [usage guide](docs/usage.md#2-decide-on-the-server) has a complete server example.

The library is a set of standard ES modules. It is not published to npm: install it from the path where you keep a copy of this repository, for example:

```bash
npm install ../interaction-bot-detector
```

## What it gives you

- **A recorder** that captures mouse, touch and keyboard events. From the keyboard it stores timings only, never which keys were pressed.
- **An analyzer** that turns a trace into a verdict, a score and the list of signals behind it. It runs in Node or in the browser.
- **An optional trap** for one important button (Save, Pay, Accept). At the moment someone is about to click it, it moves the button and records how they react.

## Documentation

- [Usage guide](docs/usage.md): integrating the recorder, the server decision and the trap, with the full API reference.
- [How it works](docs/how-it-works.md): what each signal measures, how the score is built, how the trap tells people and bots apart, measured results and limitations.

## Demo

Try it live at **https://juanmacias.com/botdetector/**.

The demo has two realistic forms, an "Edit profile" page and a "Sign up" page. Each protects its main button with the trap in `'approach'` mode: when the cursor reaches the button, a notice appears and pushes it down. A side panel shows the verdict, the signals and the mouse path live. A person gets a confirmation; a bot gets a random HTTP error page.

To run it locally, with a small Node server that makes the decision:

```bash
npm install
npm run demo
```

It opens at `http://localhost:5173/`. The hosted copy is static, with no server, so there the same decision runs in the browser; the panel says so. To build that static copy for any web server:

```bash
npm run build:static         # writes dist/botdetector/
```

## Tests

```bash
npm test                     # unit tests, no browser needed
npx playwright install chromium
npm run test:e2e             # trap and server tests in real Chromium
npm run e2e                  # compares automation strategies against the demo
```

## Project layout

| Path | Contents |
|---|---|
| `src/` | The library: `recorder.js` (recording), `analyzer.js` (signals and verdict), `trap.js` (the button trap), `native-ui.js` (recognizes dropdowns and date pickers, whose popups hide the cursor) and `index.js` (exports) |
| `demo/` | The two demo forms, the side panel, the form submission code and `decide.js`, the complete version of the server example in the usage guide |
| `scripts/` | `serve.js` (local demo server), `build-static.js` (static copy for a web server) and the browser comparison script |
| `test/` | Unit tests with synthetic and real traces; `test/e2e/` has the browser tests |

## License

[MIT](LICENSE)
