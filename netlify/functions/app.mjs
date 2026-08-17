// HEPF brochure — the gated document.
//
// index.html is only a sign-in card. The brochure itself never reaches the
// browser until Google has vouched for the visitor and that address is on
// the allow list, so an unauthenticated visitor cannot read the pages out of
// the page source.
//
// Netlify serves the files in the functions directory statically on a
// drag-and-drop deploy, so the payload is also encrypted: netlify.toml 404s
// that path, and even if it did not, the ciphertext is useless without
// PAYLOAD_KEY, which only exists in this site's environment.
//
// POST /api/app { credential } -> text/html

import { createDecipheriv } from 'node:crypto';
import { identify, mintSession, HEAD } from './lib/identity.mjs';
import { SEALED } from './lib/payload.mjs';

let cached = null;

function open() {
  if (cached) return cached;
  const hex = (process.env.PAYLOAD_KEY || '').trim();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('PAYLOAD_KEY is not set on this site');
  const buf = Buffer.from(SEALED, 'base64');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(hex, 'hex'), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  cached = Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  return cached;
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: HEAD });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'bad request' }), { status: 400, headers: HEAD }); }

  const who = await identify(body.credential);
  if (who.error) {
    return new Response(JSON.stringify({ error: who.error }), { status: who.status, headers: HEAD });
  }

  let doc;
  try { doc = open(); }
  catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: HEAD });
  }

  // Hand a credential back into the document so the toolbar can sign its own
  // save and comment calls without a second round trip. Not the Google token
  // that opened the gate — that one dies an hour after Google issued it, and
  // it took every save with it — but a twelve-hour session of our own. It is
  // also written into sessionStorage so a refresh re-enters with the session
  // and gets a fresh one, instead of replaying a half-spent Google token.
  // Both tokens are base64url, so neither can break out of the literal.
  const session = mintSession(who) || body.credential;
  const shell = doc.replace(
    '<head>',
    `<head><script>window.__CRED=${JSON.stringify(session)};`
      + `try{sessionStorage.setItem('hepf.cred',window.__CRED);}catch(e){}</script>`,
  );

  return new Response(shell, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
};

export const config = { path: '/api/app' };
