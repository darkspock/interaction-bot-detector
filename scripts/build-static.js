// Builds a static copy of the demo for a plain web server, with no Node and no
// API: a landing page, the library, the demo pages, and a config that makes the
// browser decide on each submission. The output folder can be served from any path.
//   node scripts/build-static.js [outDir]     (default: dist/botdetector)
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(process.argv[2] ?? join(root, 'dist/botdetector'));

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, 'src'), join(out, 'src'), { recursive: true });
await cp(join(root, 'demo'), join(out, 'demo'), { recursive: true });
await cp(join(root, 'LICENSE'), join(out, 'LICENSE'));

await writeFile(join(out, 'demo/config.js'), `// Static copy: there is no server, so the browser decides on each submission.
export const DECIDE_IN_BROWSER = true;
`);

// The folder's own address shows the landing page, with the demo embedded.
await cp(join(root, 'site/index.html'), join(out, 'index.html'));

console.log(`Static demo written to ${out}`);
