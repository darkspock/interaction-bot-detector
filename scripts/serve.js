// Demo server: serves the static files (ES modules do not load from file://)
// and acts as the backend for the forms. Whether a submission is accepted is
// decided here, with decide() from demo/decide.js, and not in the browser,
// where the bot could tamper with it.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from '../demo/decide.js';

export { decide, BOT_ERRORS } from '../demo/decide.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };
const MAX_BODY = 1_000_000;

const api = {
  '/api/signup': body => decide(body?.trace),
  '/api/profile': body => decide(body?.trace),
};

export function serve(port = Number(process.env.PORT) || 5173) {
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'POST' && api[path]) return handleApi(req, res, api[path]);

    // The demo pages use relative paths: they must be served from /demo/.
    if (path === '/') { res.writeHead(302, { location: '/demo/' }).end(); return; }
    const file = normalize(join(root, path.endsWith('/') ? `${path}index.html` : path));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      // no-store: after editing the demo, the browser must not show an old copy.
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

// The demo stores nothing: it analyzes the trace, answers and discards it.
async function handleApi(req, res, handler) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) { res.writeHead(413).end(); return; }
  }
  let body;
  try { body = JSON.parse(raw); } catch { res.writeHead(400).end(); return; }
  const out = handler(body);
  if (out.delayMs) await new Promise(resolve => setTimeout(resolve, out.delayMs));
  res.writeHead(out.status, { 'content-type': types['.json'], ...out.headers }).end(JSON.stringify(out.body));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await serve();
  console.log(`Demo at http://localhost:${server.address().port}/`);
}
