/* ============================================================
   PACK — builds the drag-and-drop bundle for Netlify.

   Netlify's CLI deploy is blocked from this sandbox, so the site ships
   as a zip that gets dropped on the Deploys page. Everything the site
   needs at runtime goes in; the studio master and the git plumbing
   stay out.
   ============================================================ */
import { rm, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const OUT = '/home/claude/hepf-deploy';
const ZIP = '/home/claude/hepf-drop.zip';

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT + '/netlify/functions/lib', { recursive: true });

const files = [
  'index.html', 'package.json', 'package-lock.json',
  'netlify/functions/access.mjs',
  'netlify/functions/app.mjs',
  'netlify/functions/chat.mjs',
  'netlify/functions/comments.mjs',
  'netlify/functions/settings.mjs',
  'netlify/functions/state.mjs',
  'netlify/functions/lib/config.mjs',
  'netlify/functions/lib/identity.mjs',
  'netlify/functions/lib/payload.mjs',
  'netlify/functions/lib/providers.mjs',
  'netlify/functions/lib/secret.mjs',
  'netlify/functions/lib/skill.mjs',
];
for (const f of files) await cp(f, `${OUT}/${f}`);
await cp('node_modules', OUT + '/node_modules', { recursive: true });

/* The repository netlify.toml carries a build command, because a git deploy
   has to run build.mjs. A dropped zip is already built and does not ship the
   script, so running it there just fails the deploy. Strip the [build] block
   and keep everything that matters at runtime: the functions directory, the
   404s over the source tree, and the headers. */
const toml = (await readFile('netlify.toml', 'utf8'))
  .replace(/\[build\][\s\S]*?(?=\n\[|$)/, '')
  .replace(/\[build\.environment\][\s\S]*?(?=\n\[|$)/, '')
  .replace(/^#[^\n]*\n/gm, '')
  .replace(/\n{3,}/g, '\n\n')
  .trimStart();
await writeFile(OUT + '/netlify.toml',
  '# HEPF brochure — deploy bundle. Already built; drop this zip on Netlify.\n' +
  '# The brochure is sealed in netlify/functions/lib/payload.mjs and only\n' +
  '# /api/app can open it.\n\n' +
  '[functions]\n  directory = "netlify/functions"\n  node_bundler = "esbuild"\n\n' + toml);

if (/\[build\]/.test(await readFile(OUT + '/netlify.toml', 'utf8'))) {
  console.error('✗ the bundle still asks Netlify to run a build'); process.exit(1);
}

// The sign-in card must not carry the brochure — this is the whole point
// of the gate, so it is checked on the way out of the door as well as in.
const shell = await readFile(OUT + '/index.html', 'utf8');
for (const needle of ['Basic Line', 'wsbar', 'st-presets', 'cat:\'product\'']) {
  if (shell.includes(needle)) { console.error(`✗ the sign-in card leaks "${needle}"`); process.exit(1); }
}
const payload = await readFile(OUT + '/netlify/functions/lib/payload.mjs', 'utf8');
if (!/SEALED = "[A-Za-z0-9+/=]{100000,}"/.test(payload)) {
  console.error('✗ payload looks wrong'); process.exit(1);
}
// Whatever else happens, the brochure must not be readable in the bundle.
for (const needle of ['Basic Line', 'hepf-logo', 'st-presets']) {
  if (payload.includes(needle)) { console.error(`✗ payload is not sealed — found "${needle}"`); process.exit(1); }
}

await rm(ZIP, { force: true });
execFileSync('zip', ['-qr', ZIP, '.'], { cwd: OUT });

const size = execFileSync('du', ['-h', ZIP]).toString().split('\t')[0];
console.log(`✓ ${ZIP} — ${size}`);
console.log(`  card ${(shell.length / 1024).toFixed(1)} KB · brochure ${(payload.length / 1024).toFixed(0)} KB behind /api/app`);
