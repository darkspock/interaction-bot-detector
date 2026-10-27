// Sends the demo forms to the server together with the interaction trace. The
// server decides with analyze(): a person gets a confirmation (modal) and a bot
// gets an ordinary HTTP error, shown here as the full error page it would see
// on any website. The static copy of the demo has no server and runs the same
// decision in the browser instead (see config.js).
import { decide } from './decide.js';
import { DECIDE_IN_BROWSER } from './config.js';

export const submissions = [];
export const formState = { busy: false };

const MIN_GAP_MS = 1500; // the trap may produce two proofs in a row (decoy and chase)

export function wireForm(form, { detector, endpoint, success }) {
  const submit = form.querySelector('[type=submit]');
  let lastSent = -Infinity;

  async function send() {
    if (formState.busy || performance.now() - lastSent < MIN_GAP_MS) return;
    formState.busy = true;
    lastSent = performance.now();
    submit.disabled = true;
    const data = Object.fromEntries(new FormData(form));
    delete data.password; // the demo server does not need it
    try {
      const { status, body } = DECIDE_IN_BROWSER
        ? await decideHere(detector.export())
        : await post(endpoint, { data, trace: detector.export() });
      const ok = status >= 200 && status < 300;
      submissions.push({ status, ok });
      if (ok) showModal({ ...success, state: 'ok' });
      else showErrorPage(status, body.error);
    } catch {
      submissions.push({ status: 0, ok: false });
      showModal({ state: 'error', title: 'No connection', text: 'The server could not be reached. Check your connection.' });
    } finally {
      formState.busy = false;
      submit.disabled = false;
    }
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    send();
  });
  // send() is also used when the trap catches a click: the form is sent with
  // the proof in the trace and the bot gets the server's error.
  return { send };
}

async function post(endpoint, payload) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function decideHere(trace) {
  const out = decide(trace);
  if (out.delayMs) await new Promise(resolve => setTimeout(resolve, out.delayMs));
  return out;
}

// Replaces the whole page, like an error response from the server.
function showErrorPage(status, error) {
  const title = error?.title ?? 'Error';
  const message = error?.message ?? 'An unexpected error occurred.';
  const reference = Math.random().toString(16).slice(2, 10).toUpperCase();
  document.title = `${status} ${title}`;
  document.body.className = 'error-body';
  document.body.innerHTML = `
    <main class="error-page">
      <p class="error-code">${status}</p>
      <h1></h1>
      <p class="error-message"></p>
      <a class="btn primary" href="">Try again</a>
      <p class="error-ref">Reference: ${reference}</p>
    </main>`;
  document.querySelector('.error-page h1').textContent = title;
  document.querySelector('.error-message').textContent = message;
}

let dialog;

function showModal({ title, text, state }) {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'modal';
    dialog.setAttribute('aria-labelledby', 'modal-title');
    dialog.innerHTML = `
      <form method="dialog">
        <div class="modal-icon" aria-hidden="true"></div>
        <h2 id="modal-title"></h2>
        <p></p>
        <button class="btn primary" value="close">OK</button>
      </form>`;
    document.body.append(dialog);
  }
  dialog.dataset.state = state;
  dialog.querySelector('.modal-icon').textContent = state === 'ok' ? '✓' : '!';
  dialog.querySelector('h2').textContent = title;
  dialog.querySelector('p').textContent = text;
  if (!dialog.open) dialog.showModal();
}
