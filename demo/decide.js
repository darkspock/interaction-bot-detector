// The demo's decision on a submission, shared by the demo server and by the
// static version of the demo, which has no server and decides in the browser.
// In a real deployment this belongs on the server only: anything that runs in
// the browser can be tampered with by the bot.
//
// A bot is never told it was detected: it gets an ordinary HTTP error, as if
// the site were failing, and the response explains nothing.
import { analyze } from '../src/analyzer.js';

export const BOT_ERRORS = [
  { status: 404, title: 'Not Found', message: 'The page you are looking for does not exist or has moved.' },
  { status: 429, title: 'Too Many Requests', message: 'You have sent too many requests. Wait a moment and try again.', headers: { 'retry-after': '60' } },
  { status: 500, title: 'Internal Server Error', message: 'Something went wrong. Please try again later.' },
  { status: 502, title: 'Bad Gateway', message: 'The server received an invalid response.' },
  { status: 503, title: 'Service Unavailable', message: 'The service is not available right now. Please try again later.', headers: { 'retry-after': '120' } },
  // A real timeout takes a while to arrive.
  { status: 504, title: 'Gateway Timeout', message: 'The server took too long to respond.', delayMs: 2500 },
];

// A person using the page leaves some trace: they move the mouse, click, tap
// or type. A submission with none of that never went through the page (a
// direct call to the server) and is treated as a bot.
const INTERACTION = new Set(['move', 'down', 'touch', 'keydown', 'input']);

// Whoever the analysis marks as a bot is rejected. "Insufficient data" or
// "uncertain" go through: someone filling a form with the keyboard alone
// gives little to analyze.
export function decide(trace, random = Math.random) {
  // The trace comes from the client: anything not shaped like an event is dropped.
  const events = Array.isArray(trace) ? trace.filter(e => e && typeof e === 'object' && Number.isFinite(e.t)) : [];
  const interacted = events.some(e => INTERACTION.has(e.type));
  const { verdict } = analyze(events);
  if (interacted && verdict !== 'bot') return { status: 200, body: { ok: true } };
  const { status, title, message, headers, delayMs } = BOT_ERRORS[Math.floor(random() * BOT_ERRORS.length)];
  return { status, headers, delayMs, body: { error: { status, title, message } } };
}
