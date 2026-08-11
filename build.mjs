/* ============================================================
   BUILD — turns the studio file into the deployable site.
   Strips the Brochure Studio panel and leaves everything else:
   all 15 documents, the canvas, and the comment layer.
   Run by Netlify automatically on every push.
   ============================================================ */
import { readFile, writeFile } from 'node:fs/promises';

const SRC = 'hepf-basic-line-brochure.html';
const OUT = 'index.html';

// Each entry: a human name and the exact block to remove.
const STRIP = [
  ['studio stylesheet', /<style id="studio-style">[\s\S]*?<\/style>\s*/],
  ['studio panel',      /<aside id="studio">[\s\S]*?<\/aside>\s*/],
  ['file input',        /<input type="file" id="st-file"[^>]*>\s*/],
  ['confirm modal',     /<div id="st-modal"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*/],
  ['studio script',     /<script id="studio-script">[\s\S]*?<\/script>\s*/],
];

let html = await readFile(SRC, 'utf8');
const before = html.length;
const report = [];

for (const [name, re] of STRIP) {
  if (!re.test(html)) { console.error(`✗ could not find: ${name}`); process.exit(1); }
  html = html.replace(re, '');
  report.push(name);
}

// Guard: the deployable file must still contain the whole library.
const checks = {
  'documents in model': (html.match(/cat:'(product|industry)'/g) || []).length,
  'static pages':       (html.match(/class="page/g) || []).length,
  'partner logos':      (html.match(/id="pl-/g) || []).length,
  'comment layer':      html.includes('id="cmt-bar"') ? 1 : 0,
  'canvas':             html.includes('id="wsbar"') ? 1 : 0,
  'studio removed':     html.includes('id="studio"') ? 0 : 1,
};
const failed = Object.entries(checks).filter(([, v]) => !v);
if (failed.length) { console.error('✗ build check failed:', failed.map(f => f[0]).join(', ')); process.exit(1); }

await writeFile(OUT, html);
console.log(`✓ ${OUT} written — ${(html.length / 1024).toFixed(0)} KB (stripped ${((before - html.length) / 1024).toFixed(0)} KB)`);
console.log(`  removed: ${report.join(', ')}`);
console.log(`  kept:    ${checks['documents in model']} generated documents, ${checks['static pages']} static pages, comments, canvas`);
