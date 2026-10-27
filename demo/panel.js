// Side panel shared by the demos: verdict, trap state, signals and the mouse
// path drawn over the page.
import { DECIDE_IN_BROWSER } from './config.js';

const VERDICTS = { human: 'Human', bot: 'Bot', uncertain: 'Uncertain', 'insufficient-data': 'Not enough data' };

export function mountPanel(aside, { detector, trap, trapLabel, received, submissions = [], onReset }) {
  aside.innerHTML = `
    <div>
      <div class="verdict" data-v="insufficient-data">No data</div>
      <div class="small" data-summary></div>
    </div>
    <div>
      <div class="bar"><div></div></div>
      <div class="small" data-score></div>
    </div>
    <div class="trap"></div>
    <table></table>
    <div class="actions">
      <button type="button" data-reset>Reset</button>
      <button type="button" data-export>Download trace</button>
    </div>
    <div class="small">Score = combined probability of the active signals (0 human, 1 bot). The thresholds are heuristic and not calibrated against real data.</div>
    ${DECIDE_IN_BROWSER ? '<div class="small">This hosted copy has no server, so the browser decides on each submission. In a real deployment the server decides: a bot can tamper with anything that runs in the browser.</div>' : ''}`;
  const $ = selector => aside.querySelector(selector);
  const canvas = document.createElement('canvas');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');

  function render() {
    const r = detector.analyze();
    $('.verdict').textContent = VERDICTS[r.verdict];
    $('.verdict').dataset.v = r.verdict;
    $('[data-summary]').textContent = `${r.stats.moves} moves · ${r.stats.strokes} strokes · ${r.stats.clicks} clicks · ${r.stats.keys} keys`;
    $('.bar > div').style.width = `${r.score * 100}%`;
    $('[data-score]').textContent = `Bot score: ${r.score.toFixed(2)}`;
    const kinds = trap.evidence.map(e => e.kind).join(', ') || 'none';
    $('.trap').innerHTML = `<strong>Trap on “${trapLabel}”</strong> · moved ${trap.springs} times<br>`
      + `Evidence: ${kinds}<br>Last button that received the click: ${received.at(-1) ?? '—'}<br>`
      + `Server response to the last submission: ${submissions.at(-1)?.status ?? '—'}`;
    $('table').innerHTML = r.signals.map(s =>
      `<tr class="${s.contribution > 0 ? 'on' : ''}"><td>${s.label}<div class="small">${s.detail}</div></td><td>${s.contribution.toFixed(2)}</td></tr>`).join('');
    drawTrail();
  }

  function drawTrail() {
    const dpr = devicePixelRatio || 1;
    if (canvas.width !== innerWidth * dpr || canvas.height !== innerHeight * dpr) {
      canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
      canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const color = getComputedStyle(document.documentElement).getPropertyValue('--trail');
    const recent = detector.recorder.events.slice(-600);
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let pen = false;
    for (const e of recent) {
      if (e.type === 'leave') { pen = false; continue; }
      if (e.type !== 'move') continue;
      pen ? ctx.lineTo(e.x, e.y) : ctx.moveTo(e.x, e.y);
      pen = true;
    }
    ctx.stroke();
    for (const e of recent) if (e.type === 'down') { ctx.beginPath(); ctx.arc(e.x, e.y, 4, 0, Math.PI * 2); ctx.fill(); }
  }

  $('[data-reset]').addEventListener('click', () => {
    detector.reset();
    trap.reset();
    received.length = 0;
    onReset?.();
    render();
  });
  $('[data-export]').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(detector.export())], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'interaction-trace.json' });
    a.click();
    URL.revokeObjectURL(a.href);
  });
  setInterval(render, 250);
  render();
}
